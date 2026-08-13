const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { _internals } = require('../src/services/venda-importacao-empresas.service');

function chave(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function montarReferencias() {
  return {
    usuariosPorNome: new Map([
      [chave('THAIARA'), { id: 10, nome: 'THAIARA' }],
      [chave('NAYARA'), { id: 11, nome: 'NAYARA' }]
    ]),
    operadorasPorNome: new Map([[chave('CLARO'), { id: 3, nome: 'Claro' }]]),
    tiposPorNome: new Map(),
    servicosPorNome: new Map([[chave('Telefonia movel'), { id: 8, nome: 'Telefonia movel' }]]),
    tiposProdutoPorNome: new Map([[chave('MOVEL'), { id: 20, nome: 'MOVEL' }]])
  };
}

test('preserva dia de datas vindas do Excel em UTC', () => {
  assert.equal(_internals.normalizarData(new Date('2026-01-19T00:00:00.000Z')), '2026-01-19');
});

test('importacao aceita apenas datas de vendas antigas anteriores ao dia atual', () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Vendas');
  worksheet.addRow(['CNPJ', 'DATA DA VENDA']);
  worksheet.addRow(['00.821.823/0001-88', '04/08/2026']);
  worksheet.addRow(['03.198.929/0001-65', '05/08/2026']);
  worksheet.addRow(['11.111.111/0001-11', '']);

  const resultado = _internals.lerLinhasPlanilha(
    worksheet,
    { cnpj: 'CNPJ', data_venda: 'DATA DA VENDA' },
    new Date('2026-08-05T15:00:00.000Z')
  );

  assert.equal(resultado.linhas.length, 1);
  assert.equal(resultado.linhas[0].dataVenda, '2026-08-04');
  assert.equal(resultado.erros.length, 2);
  assert.match(resultado.erros[0].message, /anterior ao dia atual/i);
  assert.match(resultado.erros[1].message, /ausente ou inválida/i);
});

test('agrupa linhas da mesma venda compartilhada por CNPJ e data', () => {
  const linhas = [
    {
      rowIndex: 2,
      cnpjDigitos: '00821823000188',
      cnpj: '00.821.823/0001-88',
      razaoSocial: 'CLINICA ORTOPEDICA UBA LTDA',
      cidade: 'UBA',
      uf: 'MG',
      quantidade: 1,
      produto: 'MOVEL',
      valor: 69.99,
      receita: 69.99,
      novo: '1',
      portabilidade: '',
      consultor: 'THAIARA',
      dataVenda: '2026-01-19',
      dataInput: '2026-01-19',
      dataAceite: '2026-01-20',
      status: 'ACEITE OK',
      operadora: 'CLARO',
      whatsapp: '32998836053',
      rl: 'SAMIR MUSSI',
      email: 'cliente@test.local'
    },
    {
      rowIndex: 3,
      cnpjDigitos: '00821823000188',
      cnpj: '00.821.823/0001-88',
      razaoSocial: 'CLINICA ORTOPEDICA UBA LTDA',
      cidade: 'UBA',
      uf: 'MG',
      quantidade: 1,
      produto: 'MOVEL',
      valor: 69.99,
      receita: 69.99,
      novo: '1',
      portabilidade: '',
      consultor: 'NAYARA',
      dataVenda: '2026-01-19',
      dataInput: '2026-01-19',
      dataAceite: '2026-01-20',
      status: 'ACEITE OK',
      operadora: 'CLARO',
      whatsapp: '32998836053',
      rl: 'SAMIR MUSSI',
      email: 'cliente@test.local'
    }
  ];

  const resultado = _internals.agruparLinhas(linhas, montarReferencias());
  assert.equal(resultado.clientes.length, 1);
  assert.equal(resultado.grupos.length, 1);
  assert.deepEqual(resultado.grupos[0].linhas, [2, 3]);
  assert.deepEqual(resultado.grupos[0].vendedorasIds, [10, 11]);
  assert.equal(resultado.grupos[0].tipoProdutoId, 20);
  assert.equal(resultado.grupos[0].itensChips.length, 2);
  assert.equal(resultado.grupos[0].itensChips[0].vendedora_id, 10);
  assert.equal(resultado.grupos[0].itensChips[1].vendedora_id, 11);
});

test('sinaliza produtos que serao cadastrados automaticamente', () => {
  const referencias = montarReferencias();
  referencias.tiposProdutoPorNome = new Map();

  const resultado = _internals.agruparLinhas([{
    rowIndex: 4,
    cnpjDigitos: '03198929000165',
    cnpj: '03.198.929/0001-65',
    razaoSocial: 'TESA-LAB TECNOLOGIA EM SERVICOS AMBIENTAIS LTDA',
    quantidade: 1,
    produto: 'CLARO TV 4K',
    valor: 99.9,
    receita: 99.9,
    consultor: 'NAYARA',
    dataVenda: '2026-01-20',
    status: 'ACEITE OK',
    operadora: 'CLARO'
  }], referencias);

  assert.deepEqual(resultado.avisos.produtos_a_cadastrar, ['CLARO TV 4K']);
  assert.equal(resultado.grupos[0].tipoProdutoId, null);
});

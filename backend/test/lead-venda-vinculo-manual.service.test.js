const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-venda-vinculo-manual.service');

test('usa primeiro o CNPJ canonico da sondagem', () => {
  const resultado = _internals.resolverCnpjFuturoCliente({
    sondagem_cnpj: '12.345.678/0001-90',
    dados_json: { CNPJ: '98.765.432/0001-10' }
  });

  assert.deepEqual(resultado, { cnpj: '12345678000190', origem: 'sondagem' });
});

test('usa o mailing somente quando existe um unico CNPJ reconhecido', () => {
  const resultado = _internals.resolverCnpjFuturoCliente({
    dados_json: JSON.stringify({ documento: '12.345.678/0001-90', empresa: 'Avance' })
  });

  assert.deepEqual(resultado, { cnpj: '12345678000190', origem: 'mailing' });
  assert.throws(
    () => _internals.resolverCnpjFuturoCliente({
      dados_json: { CNPJ: '12.345.678/0001-90', 'CNPJ filial': '98.765.432/0001-10' }
    }),
    error => error.statusCode === 422 && /mais de um CNPJ/.test(error.message)
  );
});

test('nao aceita busca sem CNPJ reconhecido', () => {
  assert.throws(
    () => _internals.resolverCnpjFuturoCliente({ dados_json: { empresa: 'Avance' } }),
    error => error.statusCode === 422 && /CNPJ valido/.test(error.message)
  );
});

test('aceita CNPJ alternativo valido sem alterar a referencia original', () => {
  const linha = {
    sondagem_cnpj: '12.345.678/0001-90',
    dados_json: { CNPJ: '12.345.678/0001-90' }
  };

  assert.deepEqual(
    _internals.resolverCnpjPesquisa(linha, '17.025.544/0007-04'),
    { cnpj: '17025544000704', origem: 'informado' }
  );
  assert.deepEqual(
    _internals.resolverCnpjPesquisa(linha),
    { cnpj: '12345678000190', origem: 'sondagem' }
  );
});

test('rejeita CNPJ alternativo invalido e venda de outro documento', () => {
  assert.throws(
    () => _internals.resolverCnpjPesquisa({}, '12.345.678/0001-90'),
    error => error.statusCode === 422 && /inválido/.test(error.message)
  );
  assert.throws(
    () => _internals.validarVendaCompativelComCnpj({ cnpj: '17025544000704' }, '11222333000181'),
    error => error.statusCode === 409 && /outro CNPJ/.test(error.message)
  );
});

test('normaliza o CNPJ efetivo da venda e so usa o cliente como fallback', () => {
  assert.equal(_internals.normalizarCnpjVenda({ cnpj: '12345678000190', cliente_cnpj_digitos: '98765432000110' }), '12345678000190');
  assert.equal(_internals.normalizarCnpjVenda({ cnpj: '', cliente_cnpj_digitos: '12.345.678/0001-90' }), '12345678000190');
  assert.equal(_internals.normalizarCnpjVenda({ cnpj: '1234567000189' }), '01234567000189');
});

test('candidata preserva vendedores e criador e bloqueia venda cancelada', () => {
  const candidata = _internals.montarVendaCandidata({
    id: 7,
    razao_social: 'Empresa A',
    cancelada_em: '2026-08-18 10:00:00',
    vendedora_id: 4,
    vendedora_nome: 'Vendedora principal',
    criado_por_id: 8,
    criador_nome: 'Criador'
  });

  assert.equal(candidata.disponivel, false);
  assert.equal(candidata.motivo_bloqueio, 'Venda cancelada');
  assert.deepEqual(candidata.vendedores, [{ id: 4, nome: 'Vendedora principal' }]);
  assert.deepEqual(candidata.criador, { id: 8, nome: 'Criador' });
});

test('candidata informa o futuro cliente que ja possui a venda', () => {
  const candidata = _internals.montarVendaCandidata(
    { id: 9, razao_social: 'Empresa B' },
    { linhaPorVenda: new Map([[9, 33]]), manualPorVenda: new Map([[9, { id: 2 }]]) }
  );

  assert.equal(candidata.disponivel, false);
  assert.equal(candidata.futuro_cliente_vinculado_id, 33);
  assert.match(candidata.motivo_bloqueio, /#33/);
  assert.equal(candidata.vinculo_manual, true);
});

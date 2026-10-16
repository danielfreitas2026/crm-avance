const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { gerarXlsxClaro } = require('../src/services/venda-xlsx-claro.service');

async function planilha(venda) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await gerarXlsxClaro(venda));
  return workbook.worksheets[0];
}

test('planilha Claro lista DDDs novos e identifica o DDD de cada linha sem sobrescrever portados', async () => {
  const ws = await planilha({ quantidade_linhas: 4, ddd: '31', numeros_portados: JSON.stringify(['31999990000']),
    valores_unitarios_chips: [
      { quantidade: 1, gb: '50', valor_unitario: 40, tipo_linha: 'portabilidade', ddd: '31' },
      { quantidade: 2, gb: '25', valor_unitario: 30, tipo_linha: 'novo', ddd: '11' },
      { quantidade: 1, gb: '10', valor_unitario: 20, tipo_linha: 'novo', ddd: '21' }
    ]
  });
  assert.match(ws.getCell('D17').value, /\(X\)21/);
  assert.match(ws.getCell('D17').value, /Outros Estado \(informar DDD\): 11$/);
  assert.doesNotMatch(ws.getCell('D17').value, /31/);
  assert.match(ws.getCell('A20').value, /50GB - DDD 31/);
  assert.equal(ws.getCell('F20').value, '31999990000');
  assert.match(ws.getCell('A21').value, /25GB - DDD 11/);
  assert.match(ws.getCell('A22').value, /25GB - DDD 11/);
  assert.match(ws.getCell('A23').value, /10GB - DDD 21/);
  assert.equal(ws.getCell('F23').value, null);
  assert.equal(ws.getCell('B21').value, 30);
});

test('planilha Claro mantém DDD legado e marca o DDD fixo único', async () => {
  const ws = await planilha({ quantidade_linhas: 1, ddd: '21', valores_unitarios_chips: '1x49,90' });
  assert.match(ws.getCell('D17').value, /\(X\)21/);
  assert.match(ws.getCell('A20').value, /DDD 21/);
});

test('planilha Claro respeita DDD explicitamente vazio e vendas sem DDD', async () => {
  for (const venda of [
    { quantidade_linhas: 1 },
    { ddd: '21', valores_unitarios_chips: [{ quantidade: 1, valor_unitario: 30, ddd: '' }] }
  ]) {
    const ws = await planilha(venda);
    assert.doesNotMatch(ws.getCell('A20').value, /DDD/);
    assert.match(ws.getCell('D17').value, /\( \)21/);
  }
});


test('planilha Claro marca todos os DDDs fixos selecionados nas linhas novas', async () => {
  const ws = await planilha({ quantidade_linhas: 3, valores_unitarios_chips: ['21', '22', '24'].map(ddd => ({
    quantidade: 1, valor_unitario: 30, ddd
  })) });
  assert.match(ws.getCell('D17').value, /\(X\)21.*\(X\)22.*\(X\)24.*\( \) Outros/);
});

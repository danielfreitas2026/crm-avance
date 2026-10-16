const test = require('node:test');
const assert = require('node:assert/strict');
const LeadLinha = require('../src/models/LeadLinha');
const auditoria = require('../src/services/audit-log.service');
const notificacao = require('../src/services/notificacao.service');
const service = require('../src/services/lead-planilha.service');

test('conclusão de retorno grava uma auditoria por agendamento, inclusive com chamadas concorrentes', async t => {
  const linha = { id: 1, atribuido_para_id: 7, futuro_cliente: true,
    futuro_cliente_retorno: '2025-02-10T12:00:00Z', futuro_cliente_retorno_realizado_em: null };
  const auditorias = [];
  let fila = Promise.resolve();
  const trx = {};
  t.mock.method(LeadLinha, 'transaction', trabalho => {
    const resultado = fila.then(() => trabalho(trx));
    fila = resultado.catch(() => {});
    return resultado;
  });
  t.mock.method(LeadLinha, 'query', () => {
    const builder = {
      findById() { return builder; }, forUpdate() { return builder; },
      withGraphFetched() { return builder; }, modifyGraph() { return builder; },
      async patchAndFetchById(id, patch) { Object.assign(linha, patch); return { ...linha }; },
      then(resolve, reject) { return Promise.resolve({ ...linha }).then(resolve, reject); }
    };
    return builder;
  });
  t.mock.method(auditoria, 'registrar', async (req, dados, transacao) => {
    assert.equal(transacao, trx);
    auditorias.push(dados);
  });
  t.mock.method(notificacao, 'desativarAlertasObrigatoriosDaLinha', async () => {});
  await Promise.all([service.realizarRetornoLead(1, 7, { origem: 'futuro_cliente' }),
    service.realizarRetornoLead(1, 7, { origem: 'futuro_cliente' })]);
  await service.realizarRetornoLead(1, 7, { origem: 'futuro_cliente' });
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0].acao, 'lead_linha.retorno_realizado');
  assert.equal(auditorias[0].usuario_id, 7);
  assert.ok(auditorias[0].dados.ocorrido_em);
  linha.futuro_cliente_retorno = '2025-03-10T12:00:00Z';
  linha.futuro_cliente_retorno_realizado_em = null;
  await service.realizarRetornoLead(1, 7, { origem: 'futuro_cliente' });
  assert.equal(auditorias.length, 2);
});

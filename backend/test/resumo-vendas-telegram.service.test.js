const test = require('node:test');
const assert = require('node:assert/strict');
const telegramService = require('../src/services/telegram.service');
const { enviarResumoDoDia, _internals } = require('../src/services/resumo-vendas-telegram.service');

const aceita = { consultores: 'Árlisson, Nathalia', data_registro: '2026-02-27', data_venda: '2026-02-26', data_ativacao: '2026-02-28', consultor: 'Nayara', razao_social: 'Empresa A', cnpj: '12.345.678/0001-90', quantidade_linhas: 2, valor_total: 199.8, operadora: 'Vivo', tipo_venda: 'Portabilidade', numeros_portados: '11999990000', possui_doc_na_casa: true, status_funil: 'ativacao' };
const pendente = { ...aceita, razao_social: 'Empresa B', quantidade_linhas: 1, valor_total: 49.9, tipo_venda: 'Novo', numeros_portados: null, possui_doc_na_casa: false, status_funil: 'aprovacao', data_ativacao: null };

test('monta blocos de venda com os campos solicitados', () => {
  const texto = _internals.montarBlocoVenda(aceita, { incluirAceite: true, incluirDocumentacao: true });
  assert.match(texto, /Data de cadastro: 27\/02\/2026/);
  assert.match(texto, /Data da venda: 26\/02\/2026/);
  assert.match(texto, /Data do aceite: 28\/02\/2026/);
  assert.match(texto, /Consultores: Árlisson, Nathalia/);
  assert.match(texto, /Números portados: 11999990000/);
  assert.match(texto, /Documentação: OK/);
  assert.match(texto, /Aceite: Sim/);
});

test('filtra o resumo pela data de cadastro e pela data da venda', () => {
  assert.equal(_internals.dataRegistroSql('v'), 'DATE(COALESCE(v.criado_em, v.created_at, v.data_venda))');
  const chamadas = [];
  const query = {
    whereRaw(sql, bindings) { chamadas.push(['whereRaw', sql, bindings]); return this; },
    whereBetween(campo, intervalo) { chamadas.push(['whereBetween', campo, intervalo]); return this; }
  };
  assert.equal(_internals.aplicarFiltroPeriodoVendas(query, '2026-07-29', '2026-07-29'), query);
  assert.deepEqual(chamadas, [
    ['whereRaw', 'DATE(COALESCE(v.criado_em, v.created_at, v.data_venda)) BETWEEN ? AND ?', ['2026-07-29', '2026-07-29']],
    ['whereBetween', 'v.data_venda', ['2026-07-29', '2026-07-29']]
  ]);
});

test('ativa agendamento apenas no ambiente correto', () => {
  assert.equal(_internals.agendamentoAtivo('', 'development'), false);
  assert.equal(_internals.agendamentoAtivo('', 'production'), true);
  assert.equal(_internals.agendamentoAtivo('true', 'development'), true);
  assert.equal(_internals.agendamentoAtivo('false', 'production'), false);
});

test('separa totais diarios por etapa Ativação', () => {
  const texto = _internals.montarMensagensDiarias([aceita, pendente], '2026-02-27').join('\n');
  assert.match(texto, /2 UGRs com aceite/);
  assert.match(texto, /1 UGR sem aceite/);
  assert.match(texto, /Documentação: Pendente/);
});

test('fechamento semanal inicia na segunda-feira', () => {
  assert.equal(_internals.inicioSemana('2026-02-27'), '2026-02-23');
  const mensagens = _internals.montarMensagensSemanais([aceita, pendente], '2026-02-23', '2026-02-27');
  assert.match(mensagens[0], /Fechamento da semana \[23\/02\/2026 até 27\/02\/2026\]: Vendas com aceite/);
  assert.match(mensagens.join('\n'), /Vendas sem aceite/);
});
test('agenda o próximo resumo somente em dia útil', () => {
  assert.equal(_internals.proximaExecucao(new Date('2026-02-27T17:00:00-03:00')).toISOString(), '2026-02-27T21:00:00.000Z');
  assert.equal(_internals.proximaExecucao(new Date('2026-02-27T18:01:00-03:00')).toISOString(), '2026-03-02T21:00:00.000Z');
  assert.equal(_internals.proximaExecucao(new Date('2026-02-28T10:00:00-03:00')).toISOString(), '2026-03-02T21:00:00.000Z');
  assert.equal(_internals.proximaExecucao(new Date('2026-03-01T10:00:00-03:00')).toISOString(), '2026-03-02T21:00:00.000Z');
});
test('ignora o envio quando a data é sábado ou domingo', async t => {
  t.mock.method(telegramService, 'resumoVendasAtivo', () => true);
  assert.deepEqual(await enviarResumoDoDia('2026-02-28'), { data: '2026-02-28', mensagens: 0, ignorado: 'fim_de_semana' });
  assert.deepEqual(await enviarResumoDoDia('2026-03-01'), { data: '2026-03-01', mensagens: 0, ignorado: 'fim_de_semana' });
});
test('envia os detalhes de cada consultor em uma única mensagem', () => {
  const vendaNathalia = { ...pendente, consultor: 'Nathalia', razao_social: 'Empresa C' };
  const mensagens = _internals.montarMensagensDiarias([aceita, pendente, vendaNathalia], '2026-02-27');
  const detalhes = mensagens.filter(mensagem => mensagem.startsWith('Resultado diário'));
  assert.equal(detalhes.length, 2);
  assert.equal(detalhes.filter(mensagem => mensagem.includes('Consultor: Nayara')).length, 1);
  assert.equal(detalhes.filter(mensagem => mensagem.includes('Consultor: Nathalia')).length, 1);
});
test('não fixa Nayara no título e não duplica totais de venda compartilhada', () => {
  const vendaArlisson = { ...aceita, id: 99, consultor: 'Árlisson' };
  const vendaNathalia = { ...aceita, id: 99, consultor: 'Nathalia' };
  const mensagens = _internals.montarMensagensDiarias([vendaArlisson, vendaNathalia], '2026-02-27');
  assert.match(mensagens[0], /Resultado diário de vendas/);
  assert.doesNotMatch(mensagens[0], /Nayara/);
  assert.deepEqual(_internals.totais([vendaArlisson, vendaNathalia]), { quantidade: 2, valor: 199.8 });
});

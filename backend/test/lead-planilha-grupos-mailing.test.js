const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const { _internals } = require('../src/services/lead-planilha.service');

function compilarGrupos(grupos) {
  const query = db('lead_linhas').select('*');
  _internals.aplicarGruposMailing(query, grupos);
  return query.toSQL();
}

test('grupo Nao enviado exige ausencia de envio e consultora', () => {
  const consulta = compilarGrupos(['nao_enviado']);

  assert.match(consulta.sql, /`envio_id` is null and `atribuido_para_id` is null/);
});

test('grupo Enviado aceita somente distribuidos sem marcacoes de sondagem', () => {
  const consulta = compilarGrupos(['enviado_sem_marcacao']);

  assert.match(consulta.sql, /`envio_id` is not null or `atribuido_para_id` is not null/);
  assert.match(consulta.sql, /`cliente_recusou` is null or `cliente_recusou` = \?/);
  assert.match(consulta.sql, /`chamada_nao_atendida` is null or `chamada_nao_atendida` = \?/);
  assert.match(consulta.sql, /`retorno_agendado_em` is null/);
  assert.equal(consulta.bindings.filter(valor => valor === false).length, 3);
});

test('grupos de sondagem excluem estados posteriores do funil de venda', () => {
  const consulta = compilarGrupos(['nao_enviado', 'enviado_sem_marcacao', 'retorno_agendado']);

  assert.match(consulta.sql, /`etapa_atual` is null or `etapa_atual` = \?/);
  assert.match(consulta.sql, /`futuro_cliente` is null or `futuro_cliente` = \?/);
  assert.match(consulta.sql, /`venda_id` is null/);
  assert.match(consulta.sql, /`venda_recusada_em` is null/);
  assert.match(consulta.sql, /`venda_recusada_motivo` is null/);
});

test('grupo Venda registrada seleciona vendas vinculadas ainda visiveis sem desfazer o vinculo', () => {
  const consulta = compilarGrupos(['venda_registrada']);

  assert.match(consulta.sql, /`venda_id` is not null or `status_operacional` = \?/);
  assert.match(consulta.sql, /`venda_registrada_oculta` is null or `venda_registrada_oculta` = \?/);
  assert.doesNotMatch(consulta.sql, /`venda_id` is null/);
  assert.ok(consulta.bindings.includes('vendido'));
});

test('grupos marcados exigem que o mailing ja tenha sido distribuido', () => {
  const casos = [
    ['chamada_nao_atendida', '`chamada_nao_atendida` = ?'],
    ['cliente_recusou', '`cliente_recusou` = ?'],
    ['retorno_agendado', '`retorno_agendado_em` is not null']
  ];

  casos.forEach(([grupo, trecho]) => {
    const consulta = compilarGrupos([grupo]);
    assert.match(consulta.sql, /`envio_id` is not null or `atribuido_para_id` is not null/);
    assert.ok(consulta.sql.includes(trecho));
  });
});

test('combina grupos com OR em uma unica consulta sem gerar duplicidade por join', () => {
  const consulta = compilarGrupos(['nao_enviado', 'cliente_recusou', 'retorno_agendado']);

  assert.match(consulta.sql, /\) or \(\(/);
  assert.doesNotMatch(consulta.sql, / join /i);
});

test('limpa somente as marcacoes selecionadas e todos os seus metadados', () => {
  const limpeza = _internals.montarLimpezaStatusReenvio(['cliente_recusou']);

  assert.deepEqual(limpeza, {
    cliente_recusou: false,
    cliente_recusou_motivo: null,
    cliente_recusou_em: null,
    cliente_recusou_por_id: null
  });
  assert.equal(Object.hasOwn(limpeza, 'chamada_nao_atendida'), false);
  assert.equal(Object.hasOwn(limpeza, 'retorno_agendado_em'), false);
});

test('limpa juntas todas as marcacoes escolhidas', () => {
  const limpeza = _internals.montarLimpezaStatusReenvio([
    'chamada_nao_atendida',
    'retorno_agendado'
  ]);

  assert.equal(limpeza.chamada_nao_atendida, false);
  assert.equal(limpeza.chamada_nao_atendida_motivo, null);
  assert.equal(limpeza.retorno_agendado_em, null);
  assert.equal(limpeza.retorno_agendado_observacao, null);
  assert.equal(Object.hasOwn(limpeza, 'cliente_recusou'), false);
});

test('patch de reenvio transfere para a nova consultora e volta para sondagem pendente', () => {
  const limpeza = _internals.montarLimpezaStatusReenvio(['chamada_nao_atendida']);
  const patch = _internals.montarPatchDivisao(27, 81, 'sondagem', {
    primeira_ligacao_status: 'historico-preservado'
  }, limpeza);

  assert.equal(patch.atribuido_para_id, 27);
  assert.equal(patch.envio_id, 81);
  assert.equal(patch.etapa_atual, 'sondagem');
  assert.equal(patch.status_operacional, 'pendente');
  assert.equal(patch.chamada_nao_atendida, false);
  assert.equal(patch.primeira_ligacao_status, 'historico-preservado');
  assert.ok(patch.updated_at instanceof Date);
});

test('patch da venda registrada preserva o estado operacional da venda', () => {
  const patch = _internals.montarPatchDivisao(
    27,
    81,
    'sondagem',
    {},
    {},
    { preservarStatusOperacional: true }
  );

  assert.equal(patch.atribuido_para_id, 27);
  assert.equal(patch.envio_id, 81);
  assert.equal(Object.hasOwn(patch, 'status_operacional'), false);
});

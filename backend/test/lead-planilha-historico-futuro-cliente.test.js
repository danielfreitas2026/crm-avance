const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');
const leadPlanilhaService = require('../src/services/lead-planilha.service');
const leadPlanilhaController = require('../src/controllers/lead-planilha.controller');

const { resolverEstadoAtualFuturoCliente, montarEventosHistoricoFuturoCliente } = _internals;

const linhaBase = {
  id: 10,
  futuro_cliente: true,
  futuro_cliente_destino: 'carteira',
  futuro_cliente_marcado_em: '2026-08-01 09:00:00',
  futuro_cliente_marcado_por_id: 1,
  futuroClienteMarcadoPor: { id: 1, nome: 'Ana' },
  status_operacional: 'qualificado'
};

test('resolve os estados canonicos sem promover uma atribuicao encerrada a estado atual', () => {
  const carteira = resolverEstadoAtualFuturoCliente(linhaBase);
  assert.equal(carteira.codigo, 'na_carteira');
  assert.equal(carteira.responsavel.nome, 'Ana');

  const aguardando = resolverEstadoAtualFuturoCliente(linhaBase, {
    status: 'aguardando_aceite', usuario_id: 2, usuario_nome: 'Bia', atribuido_em: '2026-08-02 10:00:00'
  });
  assert.equal(aguardando.codigo, 'aguardando_aceite');
  assert.equal(aguardando.responsavel.nome, 'Bia');

  const atendimento = resolverEstadoAtualFuturoCliente(linhaBase, {
    status: 'aceito', usuario_id: 3, usuario_nome: 'Caio', aceite_em: '2026-08-02 10:05:00'
  });
  assert.equal(atendimento.codigo, 'em_atendimento');
  assert.equal(atendimento.responsavel.nome, 'Caio');

  const devolvido = resolverEstadoAtualFuturoCliente(
    { ...linhaBase, futuro_cliente_destino: 'distribuicao' },
    { status: 'recusado', usuario_id: 3, usuario_nome: 'Caio', finalizado_em: '2026-08-02 10:10:00', cancelamento_motivo: 'Sem disponibilidade' }
  );
  assert.equal(devolvido.codigo, 'devolvido');
  assert.equal(devolvido.responsavel, null);
  assert.equal(devolvido.ultimo_retorno.motivo, 'Sem disponibilidade');
});

test('prioriza retorno e estados finais da jornada', () => {
  assert.equal(resolverEstadoAtualFuturoCliente({ ...linhaBase, futuro_cliente_retorno: '2026-08-30 10:00:00' }).codigo, 'retorno_marcado');
  assert.equal(resolverEstadoAtualFuturoCliente({ ...linhaBase, venda_id: 99 }).codigo, 'venda_registrada');
  assert.equal(resolverEstadoAtualFuturoCliente({ ...linhaBase, cliente_recusou: true }).codigo, 'cliente_recusou');
  assert.equal(resolverEstadoAtualFuturoCliente({ ...linhaBase, venda_recusada_em: '2026-08-03 10:00:00' }).codigo, 'venda_recusada');
});

test('monta a jornada em ordem cronologica com varios responsaveis e motivo da devolucao', () => {
  const eventos = montarEventosHistoricoFuturoCliente(linhaBase, [
    { id: 1, etapa: 'sondagem', usuario_id: 1, usuario_nome: 'Ana', atribuido_em: '2026-08-01 08:00:00' },
    { id: 2, etapa: 'venda', usuario_id: 2, usuario_nome: 'Bia', atribuido_em: '2026-08-02 09:00:00', aceite_em: '2026-08-02 09:05:00', aceite_status: 'recusado', finalizado_em: '2026-08-02 09:20:00', cancelamento_motivo: 'Cliente pediu outro horário' },
    { id: 3, etapa: 'venda', usuario_id: 3, usuario_nome: 'Caio', atribuido_em: '2026-08-03 09:00:00', aceite_status: 'aguardando_aceite' }
  ], [], null);

  assert.deepEqual(eventos.map(evento => evento.tipo), ['atribuicao', 'registro', 'atribuicao', 'aceite', 'devolucao', 'atribuicao']);
  assert.equal(eventos.find(evento => evento.tipo === 'devolucao').motivo, 'Cliente pediu outro horário');
  assert.equal(eventos.at(-1).destinatario.nome, 'Caio');
});

test('usa fallback para registro antigo e identifica usuario removido sem expor id', () => {
  const eventos = montarEventosHistoricoFuturoCliente(
    { ...linhaBase, futuroClienteMarcadoPor: null, futuro_cliente_marcado_por_id: 44 },
    [],
    [{ acao: 'lead_linha.retorno_marcado', created_at: '2026-08-04 09:00:00', usuario_id: 55, usuario_nome: null, dados: JSON.stringify({ retorno: '2026-08-05 09:00:00' }) }]
  );
  assert.equal(eventos[0].usuario.nome, 'Usuário removido');
  assert.equal(eventos[1].usuario.nome, 'Usuário removido');
  assert.equal(eventos.some(evento => evento.usuario?.id === 44), false);
});

test('endpoint preserva 404 para futuro cliente inexistente ou fora da lista ativa', async () => {
  const original = leadPlanilhaService.obterHistoricoFuturoCliente;
  leadPlanilhaService.obterHistoricoFuturoCliente = async () => {
    const error = new Error('Futuro cliente não encontrado.');
    error.statusCode = 404;
    throw error;
  };
  const resposta = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await leadPlanilhaController.historicoFuturoCliente({ params: { id: '999' } }, resposta);
  } finally {
    console.error = originalError;
    leadPlanilhaService.obterHistoricoFuturoCliente = original;
  }
  assert.equal(resposta.statusCode, 404);
  assert.equal(resposta.body.message, 'Futuro cliente não encontrado.');
});

test('cria eventos sinteticos de retorno para registros antigos sem auditoria', () => {
  const eventos = montarEventosHistoricoFuturoCliente({
    ...linhaBase,
    updated_at: '2026-08-02 09:00:00',
    retorno_agendado_em: '2026-08-05 10:00:00',
    retorno_agendado_por_id: 1,
    retorno_agendado_realizado_em: '2026-08-05 10:10:00',
    retorno_agendado_realizado_por_id: 2
  });

  assert.ok(eventos.some(evento => evento.tipo === 'retorno_marcado'));
  assert.ok(eventos.some(evento => evento.tipo === 'retorno_realizado'));
});

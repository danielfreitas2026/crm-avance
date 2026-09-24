const test = require('node:test');
const assert = require('node:assert/strict');
const Venda = require('../src/models/Venda');
const FunilEtapa = require('../src/models/FunilEtapa');
const VendaFunilAutomacao = require('../src/models/VendaFunilAutomacao');
const VendaFunilAutomacaoHistorico = require('../src/models/VendaFunilAutomacaoHistorico');
const vendaService = require('../src/services/venda.service');
const auditLogService = require('../src/services/audit-log.service');
const service = require('../src/services/venda-funil-automacao.service');

function prepararEstado({ status = 'aceite', canceladaEm = null } = {}) {
  const originais = {
    vendaQuery: Venda.query,
    transaction: Venda.transaction,
    etapaQuery: FunilEtapa.query,
    estadoQuery: VendaFunilAutomacao.query,
    historicoQuery: VendaFunilAutomacaoHistorico.query,
    acesso: vendaService._internals.usuarioPodeAcessarVenda,
    auditoria: auditLogService.registrar
  };
  const venda = {
    id: 41,
    status_funil: 'aprovacao',
    prioridade_funil: 'alta',
    enviada_pos_venda_em: '2026-09-01 10:00:00',
    excluido_em: null,
    data_ativacao: null
  };
  const estado = {
    venda_id: 41,
    status_funil: status,
    prioridade_funil: 'alta',
    cancelada_em: canceladaEm,
    motivo_cancelamento: null
  };
  const historicos = [];
  const auditorias = [];
  let patchesVenda = 0;

  Venda.transaction = async callback => callback({ id: 'trx' });
  Venda.query = () => ({
    findById() { return this; },
    async forUpdate() { return { ...venda }; },
    async patchAndFetchById() { patchesVenda += 1; return venda; }
  });
  FunilEtapa.query = () => ({
    async findOne(filtros) {
      const etapas = { aprovacao: 1, aceite: 2, entrega: 3, concluido: 4 };
      return etapas[filtros.codigo] ? { codigo: filtros.codigo, ordem: etapas[filtros.codigo], ativo: true } : null;
    }
  });
  VendaFunilAutomacao.query = () => ({
    insert(dados) { Object.assign(estado, { ...dados, ...estado }); return this; },
    onConflict() { return this; },
    async ignore() { return estado; },
    findById() {
      return {
        then(resolve, reject) { return Promise.resolve({ ...estado }).then(resolve, reject); },
        forUpdate: async () => ({ ...estado })
      };
    },
    async patchAndFetchById(id, patch) { assert.equal(id, 41); Object.assign(estado, patch); return { ...estado }; }
  });
  VendaFunilAutomacaoHistorico.query = () => ({
    async insert(dados) { historicos.push(dados); return dados; },
    async findOne(filtros) {
      return historicos.find(item => Number(item.automacao_email_id) === Number(filtros.automacao_email_id)) || null;
    }
  });
  vendaService._internals.usuarioPodeAcessarVenda = async () => true;
  auditLogService.registrar = async (req, dados) => { auditorias.push(dados); return dados; };

  return {
    venda,
    estado,
    historicos,
    auditorias,
    get patchesVenda() { return patchesVenda; },
    restaurar() {
      Venda.query = originais.vendaQuery;
      Venda.transaction = originais.transaction;
      FunilEtapa.query = originais.etapaQuery;
      VendaFunilAutomacao.query = originais.estadoQuery;
      VendaFunilAutomacaoHistorico.query = originais.historicoQuery;
      vendaService._internals.usuarioPodeAcessarVenda = originais.acesso;
      auditLogService.registrar = originais.auditoria;
    }
  };
}

test('Gmail movimenta somente o estado automatico e preserva prioridade e venda real', async () => {
  const cenario = prepararEstado();
  try {
    const resultado = await service.movimentar(41, { status_funil: 'entrega', observacao: 'Email Vivo' }, {
      origem: 'automacao_gmail', automacaoEmailId: 88
    });
    assert.equal(resultado.status, 'ok');
    assert.equal(cenario.estado.status_funil, 'entrega');
    assert.equal(cenario.estado.prioridade_funil, 'alta');
    assert.equal(cenario.venda.status_funil, 'aprovacao');
    assert.equal(cenario.venda.data_ativacao, null);
    assert.equal(cenario.patchesVenda, 0);
    assert.equal(cenario.historicos.length, 1);
    assert.equal(cenario.historicos[0].automacao_email_id, 88);
    assert.equal(cenario.historicos[0].dados.origem_movimentacao, 'automacao_gmail');
  } finally { cenario.restaurar(); }
});

test('Gmail rejeita regressao usando o estado automatico bloqueado', async () => {
  const cenario = prepararEstado({ status: 'entrega' });
  try {
    const resultado = await service.movimentar(41, { status_funil: 'aceite' }, { origem: 'automacao_gmail' });
    assert.equal(resultado.status, 'invalid');
    assert.match(resultado.message, /regredir/);
    assert.equal(cenario.estado.status_funil, 'entrega');
    assert.equal(cenario.historicos.length, 0);
  } finally { cenario.restaurar(); }
});

test('Gmail nao repete movimento nem historico para o mesmo email', async () => {
  const cenario = prepararEstado();
  try {
    let resultado = await service.movimentar(41, { status_funil: 'entrega' }, {
      origem: 'automacao_gmail', automacaoEmailId: 88
    });
    assert.equal(resultado.alterada, true);

    resultado = await service.movimentar(41, { status_funil: 'entrega' }, {
      origem: 'automacao_gmail', automacaoEmailId: 88
    });
    assert.equal(resultado.alterada, false);
    assert.equal(cenario.historicos.length, 1);
  } finally { cenario.restaurar(); }
});

test('Claro não duplica movimento no Funil de Automações ao repetir o mesmo email', async () => {
  const cenario = prepararEstado();
  try {
    const opcoes = { origem: 'automacao_imap_claro', automacaoEmailId: 101, marcadores: { aceite: true } };
    const primeira = await service.movimentar(41, { status_funil: 'entrega' }, opcoes);
    const segunda = await service.movimentar(41, { status_funil: 'entrega' }, opcoes);
    assert.equal(primeira.alterada, true);
    assert.equal(segunda.alterada, false);
    assert.equal(cenario.venda.status_funil, 'aprovacao');
    assert.equal(cenario.estado.status_funil, 'entrega');
    assert.equal(cenario.historicos.length, 1);
  } finally { cenario.restaurar(); }
});

test('cancelamento automatico fica isolado da venda real e e idempotente', async () => {
  const cenario = prepararEstado();
  try {
    let resultado = await service.cancelar(41, { motivo: 'Pedido cancelado' }, { automacaoEmailId: 92 });
    assert.equal(resultado.status, 'ok');
    assert.equal(resultado.alterada, true);
    assert.ok(cenario.estado.cancelada_em);
    assert.equal(cenario.venda.cancelada_em, undefined);
    assert.equal(cenario.patchesVenda, 0);
    assert.equal(cenario.historicos.length, 1);

    resultado = await service.cancelar(41, { motivo: 'Pedido cancelado' }, { automacaoEmailId: 92 });
    assert.equal(resultado.alterada, false);
    assert.equal(cenario.historicos.length, 1);
  } finally { cenario.restaurar(); }
});

test('ajuste manual atualiza etapa e prioridade e gera auditoria separada', async () => {
  const cenario = prepararEstado();
  try {
    const resultado = await service.movimentar(41, { status_funil: 'entrega', prioridade_funil: 'baixa' }, {
      origem: 'ajuste_manual', usuarioId: 7
    });
    assert.equal(resultado.status, 'ok');
    assert.equal(cenario.estado.prioridade_funil, 'baixa');
    assert.equal(cenario.historicos[0].usuario_id, 7);
    assert.equal(cenario.historicos[0].origem, 'ajuste_manual');
    assert.equal(cenario.auditorias[0].acao, 'venda.funil_automacao_atualizado');
  } finally { cenario.restaurar(); }
});

test('ajuste manual nao amplia o escopo de visualizacao do usuario', async () => {
  const cenario = prepararEstado();
  try {
    vendaService._internals.usuarioPodeAcessarVenda = async () => false;
    const resultado = await service.movimentar(41, { status_funil: 'entrega' }, {
      origem: 'ajuste_manual', usuarioId: 7
    });
    assert.equal(resultado.status, 'not_found');
    assert.equal(cenario.estado.status_funil, 'aceite');
    assert.equal(cenario.historicos.length, 0);
  } finally { cenario.restaurar(); }
});

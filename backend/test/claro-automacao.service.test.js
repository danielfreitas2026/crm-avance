const test = require('node:test');
const assert = require('node:assert/strict');
const automacao = require('../src/services/automacao-email.service');
const claroImap = require('../src/services/claro-imap.service');
const Venda = require('../src/models/Venda');
const FunilEtapa = require('../src/models/FunilEtapa');
const vendaFunilAutomacaoService = require('../src/services/venda-funil-automacao.service');

function instalarConsultas(vendas, etapas) {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  Venda.query = () => ({
    alias() { return this; }, join() { return this; }, leftJoin() { return this; }, select() { return this; },
    whereRaw() { return this; }, whereNull() { return this; }, whereNotNull() { return this; },
    withGraphFetched: async () => vendas
  });
  FunilEtapa.query = () => {
    const consulta = {
      filtros: null,
      where(filtros) { this.filtros = filtros; return this; },
      orderBy() { return this; },
      findOne: async filtros => etapas.find(etapa => etapa.codigo === filtros.codigo) || null,
      then(resolve, reject) {
        const resultado = this.filtros?.etapa_final
          ? etapas.filter(etapa => etapa.etapa_final)
          : etapas.filter(etapa => etapa.ativo !== false && (!this.filtros?.aceite_biometria || etapa.aceite_biometria));
        return Promise.resolve(resultado).then(resolve, reject);
      }
    };
    return consulta;
  };
  return () => { Venda.query = queryVendaOriginal; FunilEtapa.query = queryEtapaOriginal; };
}

const etapas = [
  { codigo: 'analise', nome: 'Análise', ordem: 1, ativo: true },
  { codigo: 'aceite', nome: 'Aceite/Biometria', ordem: 2, ativo: true, aceite_biometria: true },
  { codigo: 'pedido', nome: 'Pedido na operadora', ordem: 3, ativo: true },
  { codigo: 'sms', nome: 'Confirmação SMS Portabilidade', ordem: 4, ativo: true },
  { codigo: 'final', nome: 'Final', ordem: 5, ativo: true, etapa_final: true }
];

function venda(id, extras = {}) {
  return {
    id, nome: 'Empresa Ágil', razao_social: 'Empresa Ágil Ltda', status_funil: 'analise',
    criado_em: '2026-09-01 10:00:00', enviada_pos_venda_em: '2026-09-01 11:00:00',
    excluido_em: null, cancelada_em: null, cliente: null, ...extras
  };
}

test('vínculo Claro exige uma única venda ativa, anterior ao e-mail e com nome normalizado exato', async () => {
  let restaurar = instalarConsultas([venda(1)], etapas);
  try {
    const unica = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: ' EMPRESA AGIL ' }
    );
    assert.equal(unica.venda.id, 1);
  } finally { restaurar(); }

  restaurar = instalarConsultas([venda(1), venda(2)], etapas);
  try {
    const duplicada = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(duplicada.venda, null);
    assert.match(duplicada.erro, /Mais de uma venda Claro ativa/);
    const manual = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00', revisado_por_id: 7, venda_id: 2 },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(manual.venda.id, 2);
    assert.equal(manual.candidatas.find(item => item.id === 2).manual, true);
  } finally { restaurar(); }

  restaurar = instalarConsultas([venda(1, { criado_em: '2026-09-23 10:00:00' })], etapas);
  try {
    const anterior = await automacao._internals.resolverVendaClaro(
      { origem: 'imap_claro', recebido_em: '2026-09-22 12:00:00' },
      { empresa: 'Empresa Ágil' }
    );
    assert.equal(anterior.venda, null);
  } finally { restaurar(); }
});

test('revisão manual Claro valida a venda pelo nome sem exigir CNPJ', async () => {
  const escolhida = venda(9);
  const resultado = await automacao._internals.validarVendaSelecionada(
    { origem: 'imap_claro', dados_extraidos: JSON.stringify({ empresa: 'Empresa Ágil' }), recebido_em: '2026-09-22 12:00:00' },
    { venda_id: 9 },
    { buscarClaro: async () => [escolhida], etapasFinais: async () => ['final'] }
  );
  assert.equal(resultado.venda.id, 9);
  assert.equal(resultado.cnpj, null);
});

test('Claro autenticada fica em revisão enquanto ações estão bloqueadas', async () => {
  const restaurar = instalarConsultas([venda(1)], etapas);
  const flagAnterior = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'false';
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 50, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: true,
      corpo_texto: 'O cliente Empresa Ágil ASSINOU o contrato.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'revisao');
    assert.equal(resultado.venda_id, 1);
    assert.match(resultado.erro, /aguardam homologação/);
  } finally {
    restaurar();
    if (flagAnterior === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
    else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = flagAnterior;
  }
});

test('crédito aprovado avança somente o funil comparativo e conclui marcadores automáticos', async () => {
  const restaurar = instalarConsultas([venda(1, { status_funil: 'aceite' })], etapas);
  const moverOriginal = vendaFunilAutomacaoService.movimentar;
  const flagAnterior = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  const movimentos = [];
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'true';
  vendaFunilAutomacaoService.movimentar = async (...args) => { movimentos.push(args); return { status: 'ok' }; };
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 51, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: true,
      corpo_texto: 'O pedido do cliente Empresa Ágil foi APROVADO CREDITO.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.etapa_destino, 'pedido');
    assert.equal(movimentos.length, 1);
    assert.equal(movimentos[0][0], 1);
    assert.deepEqual(movimentos[0][2].marcadores, { aceite: true, biometria: true });
    assert.equal(movimentos[0][2].origem, 'automacao_imap_claro');
  } finally {
    restaurar();
    vendaFunilAutomacaoService.movimentar = moverOriginal;
    if (flagAnterior === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
    else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = flagAnterior;
  }
});

test('falha de DKIM/DMARC nunca executa ação automática', async () => {
  const restaurar = instalarConsultas([venda(1)], etapas);
  const moverOriginal = vendaFunilAutomacaoService.movimentar;
  let moveu = false;
  vendaFunilAutomacaoService.movimentar = async () => { moveu = true; return { status: 'ok' }; };
  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 52, origem: 'imap_claro', assunto: 'STATUS DE PEDIDO', autenticacao_valida: false,
      corpo_texto: 'O pedido do cliente Empresa Ágil foi FATURADO.', recebido_em: '2026-09-22 12:00:00'
    });
    assert.equal(resultado.status, 'revisao');
    assert.match(resultado.erro, /DKIM\/DMARC/);
    assert.equal(moveu, false);
  } finally { restaurar(); vendaFunilAutomacaoService.movimentar = moverOriginal; }
});

test('flags Claro são independentes entre coleta e ações', () => {
  const coleta = process.env.CLARO_IMAP_AUTOMATION_ENABLED;
  const acoes = process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED;
  process.env.CLARO_IMAP_AUTOMATION_ENABLED = 'true';
  process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = 'false';
  try {
    assert.equal(claroImap.habilitado(), true);
    assert.equal(claroImap.acoesAutomaticasHabilitadas(), false);
  } finally {
    if (coleta === undefined) delete process.env.CLARO_IMAP_AUTOMATION_ENABLED; else process.env.CLARO_IMAP_AUTOMATION_ENABLED = coleta;
    if (acoes === undefined) delete process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED; else process.env.CLARO_IMAP_AUTO_ACTIONS_ENABLED = acoes;
  }
});

test('repetição Claro reutiliza o corpo persistido sem consultar Gmail', async () => {
  let consultouGmail = false;
  const atualizacao = await automacao._internals.prepararRepeticao(
    { origem: 'imap_claro', gmail_message_id: 'imap:dedup', corpo_texto: 'O cliente Empresa Ágil ASSINOU o contrato.' },
    async () => { consultouGmail = true; return ''; }
  );
  assert.deepEqual(atualizacao, { status: 'pendente', erro: null });
  assert.equal(consultouGmail, false);
});

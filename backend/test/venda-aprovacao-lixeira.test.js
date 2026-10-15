const test = require('node:test');
const assert = require('node:assert/strict');
const Venda = require('../src/models/Venda');
const Solicitacao = require('../src/models/VendaAprovacaoSolicitacao');
const Usuario = require('../src/models/Usuario');
const Notificacao = require('../src/models/Notificacao');
const Destinatario = require('../src/models/NotificacaoDestinatario');
const Historico = require('../src/models/VendaHistorico');
const FunilEtapa = require('../src/models/FunilEtapa');
const aprovacao = require('../src/services/venda-aprovacao.service');
const vendas = require('../src/services/venda.service');
const dashboard = require('../src/services/dashboard-integracao.service');
const email = require('../src/services/notificacao-email.service');
const notificacoes = require('../src/services/notificacao.service');
const visibilidade = require('../src/services/venda-visibilidade.service');
const telegram = require('../src/services/telegram-aprovacoes.service');

// Simula persistencia e locks de linha sem conectar a bancos ou servicos externos.
function preparar(t, status = 'pendente') {
  const estado = {
    vendas: [{ id: 7, excluido_em: null, vendedoras: [{ id: 1 }, { id: 2 }] }],
    solicitacoes: [{ id: 12, venda_id: 7, status, motivos: '["venda_compartilhada"]' }],
    notificacoes: [{ id: 3, source_key: 'venda_aprovacao:12', ativa: true }],
    historicos: [],
    etapas: [{ codigo: 'concluido', etapa_final: true }],
    usuarios: [{ id: 9, ativo: true, role: { nome: 'admin' } }],
    entidade_notas: [], notificacao_destinatarios: [], venda_notificacao_parada: []
  };
  const contexto = { estado, eventos: [], falharLimpeza: false, aoBloquear: null };
  let fila = Promise.resolve();

  function query(tabela, trx) {
    if (tabela === 'venda_aprovacao_solicitacoes') tabela = 'solicitacoes';
    const filtros = [];
    let unico = false;
    let lock = false;
    const builder = {
      findById(id) { unico = true; filtros.push(item => item.id === Number(id)); return this; },
      where(chave, valor) {
        if (typeof chave !== 'function') filtros.push(item => item[chave] === valor);
        return this;
      },
      whereNot(chave, valor) { filtros.push(item => item[chave] !== valor); return this; },
      whereNull(chave) { filtros.push(item => item[chave] == null); return this; },
      whereNotNull(chave) { filtros.push(item => item[chave] != null); return this; },
      whereIn(chave, valores) { filtros.push(item => valores.includes(item[chave])); return this; },
      whereNotIn(chave, valores) { filtros.push(item => !valores.includes(item[chave])); return this; },
      orderBy() { return this; },
      select() { return this; },
      withGraphFetched() { return this; },
      modifyGraph() { return this; },
      forUpdate() { lock = true; return this; },
      first() { unico = true; return this; },
      async executar() {
        if (lock) {
          if (tabela === 'vendas' && !trx.liberar) {
            const anterior = fila;
            fila = new Promise(resolve => { trx.liberar = resolve; });
            await anterior;
            trx.snapshot = structuredClone(estado);
          }
          contexto.eventos.push(`lock:${tabela}`);
          if (tabela === 'vendas') await contexto.aoBloquear?.();
        }
        const itens = estado[tabela].filter(item => filtros.every(filtro => filtro(item)));
        return unico ? itens[0] : itens;
      },
      then(resolve, reject) { return this.executar().then(resolve, reject); },
      async patch(payload) {
        contexto.eventos.push(`patch:${tabela}`);
        const itens = estado[tabela].filter(item => filtros.every(filtro => filtro(item)));
        for (const item of itens) {
          for (const [chave, valor] of Object.entries(payload)) {
            item[chave] = chave === 'status_anterior_obsoleta' ? item.status : valor;
          }
        }
        return itens.length;
      },
      update(payload) { return this.patch(payload); },
      async patchAndFetchById(id, payload) {
        this.findById(id);
        await this.patch(payload);
        return this.executar();
      },
      async insert(payload) { estado[tabela].push({ id: 100, ...payload }); return payload; },
      async insertAndFetch(payload) { await this.insert(payload); return estado[tabela].at(-1); },
      async delete() {
        if (contexto.falharLimpeza) throw new Error('Falha de limpeza');
        estado[tabela] = estado[tabela].filter(item => !filtros.every(filtro => filtro(item)));
      }
    };
    return builder;
  }

  async function transacao(callback) {
    const trx = nome => query(nome, trx);
    try { return await callback(trx); }
    catch (error) {
      if (trx.snapshot) Object.assign(estado, trx.snapshot);
      throw error;
    } finally { trx.liberar?.(); }
  }

  for (const [model, tabela] of [
    [Venda, 'vendas'], [Solicitacao, 'solicitacoes'], [Usuario, 'usuarios'],
    [Notificacao, 'notificacoes'], [Destinatario, 'notificacao_destinatarios'],
    [Historico, 'historicos'], [FunilEtapa, 'etapas']
  ]) t.mock.method(model, 'query', trx => query(tabela, trx));
  t.mock.method(Venda, 'transaction', transacao);
  t.mock.method(Solicitacao, 'transaction', transacao);
  t.mock.method(dashboard, 'excluirVendaNoDashboard', async () => {});
  t.mock.method(email, 'enviarEmailsPendentesAsync', () => {});
  t.mock.method(notificacoes, 'listarAdminsAtivos', async () => [9]);
  return contexto;
}

for (const status of ['pendente', 'aprovada', 'recusada']) {
  test(`exclusao invalida solicitacao ${status} e remove notificacoes na mesma transacao`, async t => {
    const { estado, eventos } = preparar(t, status);
    assert.equal(await vendas.excluirVenda(7, 9), 1);
    assert.ok(estado.vendas[0].excluido_em);
    assert.equal(estado.solicitacoes[0].status, 'obsoleta');
    assert.equal(estado.solicitacoes[0].status_anterior_obsoleta, status);
    assert.equal(estado.notificacoes.length, 0);
    assert.equal(eventos[0], 'lock:vendas');
  });
}

test('falha na limpeza reverte exclusao e obsolescencia', async t => {
  const contexto = preparar(t);
  contexto.falharLimpeza = true;
  await assert.rejects(vendas.excluirVenda(7, 9), /Falha de limpeza/);
  assert.equal(contexto.estado.vendas[0].excluido_em, null);
  assert.equal(contexto.estado.solicitacoes[0].status, 'pendente');
  assert.equal(contexto.estado.solicitacoes[0].status_anterior_obsoleta, undefined);
  assert.equal(contexto.estado.notificacoes[0].ativa, true);
});

for (const decidir of ['aprovarSolicitacao', 'recusarSolicitacao']) {
  for (const situacao of ['lixeira', 'inexistente']) {
    test(`${decidir} bloqueia venda ${situacao} e invalida pendencia antiga`, async t => {
      const { estado, eventos } = preparar(t);
      if (situacao === 'lixeira') estado.vendas[0].excluido_em = '2026-10-15 12:00:00';
      else estado.vendas = [];
      await assert.rejects(aprovacao[decidir](12, {}, 9), error =>
        error.statusCode === 409 && /Solicitação indisponível/.test(error.message));
      assert.equal(estado.solicitacoes[0].status, 'obsoleta');
      assert.equal(estado.solicitacoes[0].decidido_em, undefined);
      assert.equal(estado.historicos.length, 0);
      assert.equal(estado.notificacoes[0].ativa, false);
      assert.deepEqual(eventos.slice(0, 2), ['lock:vendas', 'lock:solicitacoes']);
    });
  }

  test(`${decidir} preserva decisao de venda ativa`, async t => {
    const { estado } = preparar(t);
    await aprovacao[decidir](12, {}, 9);
    assert.equal(estado.solicitacoes[0].status, decidir === 'aprovarSolicitacao' ? 'aprovada' : 'recusada');
    assert.equal(estado.historicos.length, 1);
  });
}

test('solicitacao removida durante a decisao retorna 404', async t => {
  const contexto = preparar(t);
  contexto.aoBloquear = () => { contexto.estado.solicitacoes = []; };
  await assert.rejects(aprovacao.aprovarSolicitacao(12, {}, 9), { statusCode: 404 });
});

for (const primeiro of ['exclusao', 'decisao']) {
  test(`concorrencia com ${primeiro} primeiro termina com aprovacao obsoleta`, async t => {
    const contexto = preparar(t);
    let sinalizar;
    const bloqueado = new Promise(resolve => { sinalizar = resolve; });
    let liberar;
    const continuar = new Promise(resolve => { liberar = resolve; });
    contexto.aoBloquear = async () => {
      contexto.aoBloquear = null;
      sinalizar();
      await continuar;
    };
    const excluir = () => vendas.excluirVenda(7, 9);
    const decidir = () => aprovacao.aprovarSolicitacao(12, {}, 9);
    const inicio = primeiro === 'exclusao' ? excluir() : decidir();
    await bloqueado;
    const concorrente = primeiro === 'exclusao' ? decidir() : excluir();
    liberar();
    const resultados = await Promise.allSettled([inicio, concorrente]);
    assert.equal(resultados[0].status, 'fulfilled');
    assert.equal(resultados[1].status, primeiro === 'exclusao' ? 'rejected' : 'fulfilled');
    if (primeiro === 'exclusao') assert.equal(resultados[1].reason.statusCode, 409);
    assert.ok(contexto.estado.vendas[0].excluido_em);
    assert.equal(contexto.estado.solicitacoes[0].status, 'obsoleta');
    assert.equal(contexto.estado.solicitacoes[0].status_anterior_obsoleta,
      primeiro === 'exclusao' ? 'pendente' : 'aprovada');
  });
}

test('novo envio de venda restaurada cria solicitacao e preserva aprovacao antiga obsoleta', async t => {
  const { estado } = preparar(t, 'aprovada');
  await vendas.excluirVenda(7, 9);
  t.mock.method(Venda, 'knex', () => () => Venda.query());
  t.mock.method(dashboard, 'restaurarVendaNoDashboard', async () => {});
  t.mock.method(dashboard, 'obterResumoSincronizacao', async () => null);
  t.mock.method(visibilidade, 'aplicarVisibilidadeVenda', async venda => venda);
  const restaurada = await vendas.restaurarVenda(7, 9);
  assert.equal(restaurada.excluido_em, null);
  assert.equal(estado.solicitacoes[0].status, 'obsoleta');
  const resultado = await aprovacao.validarEnvioPosVenda(7, 9);
  assert.equal(resultado.status, 'pendente');
  assert.equal(estado.solicitacoes.length, 2);
  assert.equal(estado.solicitacoes[0].status, 'obsoleta');
  assert.equal(estado.solicitacoes[1].status, 'pendente');
  assert.equal(estado.historicos[0].acao, 'venda.aprovacao_solicitada');
});

test('callback antigo do Telegram rejeita venda na lixeira sem registrar decisao', async t => {
  const { estado } = preparar(t);
  estado.vendas[0].excluido_em = '2026-10-15 12:00:00';
  const chatAnterior = process.env.TELEGRAM_APROVACOES_CHAT_ID;
  process.env.TELEGRAM_APROVACOES_CHAT_ID = '-100123';
  t.after(() => {
    if (chatAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_CHAT_ID;
    else process.env.TELEGRAM_APROVACOES_CHAT_ID = chatAnterior;
  });
  const resposta = await telegram.processarCallback({
    id: 'callback', data: 'va:aprovar:12', message: { chat: { id: '-100123' } }
  }, { responder: async dados => dados });
  assert.match(resposta.text, /Solicitação indisponível/);
  assert.equal(resposta.show_alert, true);
  assert.equal(estado.historicos.length, 0);
});

test('reconciliacao apos exclusao remove botoes sem bloquear a exclusao por falha externa', async t => {
  const { estado } = preparar(t);
  Object.assign(estado.solicitacoes[0], {
    telegram_message_id: '900', telegram_chat_id: '-100123', telegram_status_sincronizado: 'pendente'
  });
  assert.equal(await vendas.excluirVenda(7, 9), 1);
  const mensagens = [];
  const falhas = [];
  const opcoes = {
    buscarSolicitacao: async () => estado.solicitacoes[0],
    editar: async solicitacao => {
      mensagens.push(telegram._internals.dadosEdicao(solicitacao));
      throw new Error('Telegram indisponivel');
    },
    registrarFalha: async (item, error) => falhas.push({ item, error })
  };
  t.mock.method(console, 'error', () => {});
  const resultado = await telegram._internals.processarSincronizacao({ id: 12 }, opcoes);
  assert.equal(resultado.falhou, true);
  assert.deepEqual(mensagens[0].reply_markup.inline_keyboard, []);
  assert.match(mensagens[0].text, /DESATUALIZADA/);
  assert.equal(falhas.length, 1);
  assert.equal(estado.solicitacoes[0].status, 'obsoleta');
  opcoes.editar = async () => {};
  opcoes.registrarEdicaoSucesso = async (item, status) => {
    estado.solicitacoes[0].telegram_status_sincronizado = status;
  };
  assert.deepEqual(await telegram._internals.processarSincronizacao({ id: 12 }, opcoes),
    { atualizado: true, status: 'obsoleta' });
  assert.equal(estado.solicitacoes[0].telegram_status_sincronizado, 'obsoleta');
});

test('todos os filtros de listagem exigem venda existente fora da lixeira', async t => {
  const original = Solicitacao.query;
  const queries = [];
  t.mock.method(Solicitacao, 'query', function (...args) {
    const query = original.apply(this, args).resolve([]);
    queries.push(query);
    return query;
  });
  for (const status of [undefined, 'pendente', 'aprovada', 'recusada', 'obsoleta']) {
    assert.deepEqual(await aprovacao.listarSolicitacoes({ status }), []);
    const sql = queries.at(-1).toKnexQuery().toSQL().sql;
    assert.match(sql, /where exists \(select 1 from `vendas`/);
    assert.match(sql, /`vendas`\.`id` = `venda_aprovacao_solicitacoes`\.`venda_id`/);
    assert.match(sql, /`vendas`\.`excluido_em` is null/);
  }
});

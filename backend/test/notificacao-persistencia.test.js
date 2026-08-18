const test = require('node:test');
const assert = require('node:assert/strict');

const {
  notificacaoMudou,
  deveRearmarRetorno,
  selecionarNotificacaoPrincipal,
  sincronizarDestinatarios
} = require('../src/services/notificacao-persistencia.service');

test('sincronizacao identica nao considera a notificacao alterada', () => {
  const payload = {
    tipo: 'nota_retorno_pre',
    titulo: 'Retorno em breve',
    mensagem: 'Mensagem',
    nivel: 'warn',
    entidade: 'vendas',
    entidade_id: 7,
    dados: '{"nota_id":3}',
    ativa: true
  };

  assert.equal(notificacaoMudou({ ...payload, ativa: 1, updated_at: new Date() }, payload), false);
  assert.equal(notificacaoMudou({ ...payload, mensagem: 'Outra' }, payload), true);
});

test('somente reativacao e escalada para vencido rearmam o destinatario', () => {
  assert.equal(deveRearmarRetorno({ tipo: 'nota_retorno_pre', ativa: true }, { tipo: 'nota_retorno_due', ativa: true }), true);
  assert.equal(deveRearmarRetorno({ tipo: 'nota_retorno_pre', ativa: true }, { tipo: 'nota_retorno_pre', ativa: true }), false);
  assert.equal(deveRearmarRetorno({ tipo: 'nota_retorno_due', ativa: false }, { tipo: 'nota_retorno_pre', ativa: true }), true);
});

test('preserva o id do item ativo ao reconciliar registros pre e due legados', () => {
  const principal = selecionarNotificacaoPrincipal([
    { id: 21, source_key: 'nota_retorno_pre:5', ativa: true },
    { id: 22, source_key: 'nota_retorno_due:5', ativa: false }
  ]);

  assert.equal(principal.id, 21);
});

function criarKnexFalso() {
  const chamadas = { updates: [], inserts: [], deletes: [] };
  const existentes = [{ id: 31, usuario_id: 9 }];

  function knex() {
    const estado = { ids: [] };
    return {
      where() { return this; },
      whereIn(_campo, ids) { estado.ids = ids; return this; },
      select: async () => existentes,
      update: async patch => { chamadas.updates.push({ ids: estado.ids, patch }); },
      delete: async () => { chamadas.deletes.push(estado.ids); },
      insert(payload) { chamadas.inserts.push(payload); return this; },
      onConflict() { return this; },
      async ignore() {}
    };
  }

  return { knex, chamadas };
}

test('preserva destinatario em sincronizacao comum e limpa estados na escalada', async () => {
  const comum = criarKnexFalso();
  await sincronizarDestinatarios(5, [9], { knex: comum.knex, rearmar: false });
  assert.deepEqual(comum.chamadas, { updates: [], inserts: [], deletes: [] });

  const escalada = criarKnexFalso();
  await sincronizarDestinatarios(5, [9], { knex: escalada.knex, rearmar: true });
  assert.deepEqual(escalada.chamadas.updates, [{
    ids: [31],
    patch: {
      lida_em: null,
      popup_visto_em: null,
      ocultada_em: null,
      email_enviado_em: null
    }
  }]);
  assert.deepEqual(escalada.chamadas.inserts, []);
  assert.deepEqual(escalada.chamadas.deletes, []);
});

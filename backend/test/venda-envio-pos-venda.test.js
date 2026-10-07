const test = require('node:test');
const assert = require('node:assert/strict');
const Usuario = require('../src/models/Usuario');
const Venda = require('../src/models/Venda');
const vendaService = require('../src/services/venda.service');
const aprovacaoService = require('../src/services/venda-aprovacao.service');
const router = require('../src/routes/venda.routes');

function preparar(t, permissoes, venda = { id: 7, vendedora_id: 9 }, compartilhada = false) {
  const usuario = { id: 9, ativo: true, role: { nome: 'usuario' }, permissoes };
  t.mock.method(Usuario, 'query', () => ({
    findById() { return this; },
    withGraphFetched: async () => usuario
  }));
  t.mock.method(Venda, 'query', () => ({
    findById() { return this; },
    select() { return this; },
    whereNull() { return this; },
    then(resolve, reject) { return Promise.resolve(venda).then(resolve, reject); }
  }));
  t.mock.method(Venda, 'knex', () => () => ({
    where() { return this; },
    first: async () => compartilhada ? { usuario_id: 9 } : undefined
  }));
  t.mock.method(Venda, 'transaction', async callback => callback('transacao-teste'));
  const validar = t.mock.method(aprovacaoService, 'validarEnvioPosVenda', async () => ({ status: 'pendente' }));
  return validar;
}

for (const [nome, permissoes, venda, compartilhada] of [
  ['própria', { vendas_ver_proprias: true }, { id: 7, vendedora_id: 9 }, false],
  ['criada pelo usuário', { vendas_ver_proprias: true }, { id: 7, criado_por_id: 9, vendedora_id: 10 }, false],
  ['compartilhada', { ver_vendas_compartilhadas: true }, { id: 7, vendedora_id: 10 }, true],
  ['de terceiros', { vendas_ver_todas: true }, { id: 7, vendedora_id: 10 }, false]
]) {
  test(`envio de venda ${nome} sem edição passa pela rota e mantém aprovação`, async t => {
    const validar = preparar(t, permissoes, venda, compartilhada);
    const rota = router.stack.find(layer => layer.route?.path === '/:id/enviar-pos-venda').route;
    let permitido = false;
    const res = { status() { return this; }, json() { assert.fail('Rota bloqueou visualização autorizada'); } };
    await rota.stack[0].handle({ usuario: { id: 9 } }, res, () => { permitido = true; });
    assert.equal(permitido, true);
    const dados = { motivo_descricao: 'Solicitação de envio' };
    assert.deepEqual(await vendaService.enviarVendaParaPosVenda(7, 9, dados), { status: 'pendente' });
    assert.deepEqual(validar.mock.calls[0].arguments, [7, 9, dados, 'transacao-teste']);
  });
}

for (const [nome, permissoes, venda] of [
  ['sem visualização mesmo com edição', { vendas_editar: true }, { id: 7, vendedora_id: 9 }],
  ['fora das vendas próprias', { vendas_ver_proprias: true }, { id: 7, vendedora_id: 10 }],
  ['sem vínculo compartilhado', { ver_vendas_compartilhadas: true }, { id: 7, vendedora_id: 10 }],
  ['excluída', { vendas_ver_todas: true }, { id: 7, excluido_em: '2026-10-07 10:00:00' }],
  ['inexistente', { vendas_ver_todas: true }, null]
]) {
  test(`envio rejeita venda ${nome}`, async t => {
    const validar = preparar(t, permissoes, venda);
    assert.deepEqual(await vendaService.enviarVendaParaPosVenda(7, 9), { status: 'not_found' });
    assert.equal(validar.mock.callCount(), 0);
  });
}

test('envio repetido não solicita aprovação nem altera a venda', async t => {
  const venda = { id: 7, enviada_pos_venda_em: '2026-10-07 10:00:00' };
  const validar = preparar(t, { vendas_ver_todas: true }, venda);
  assert.deepEqual(await vendaService.enviarVendaParaPosVenda(7, 9), { status: 'already_sent', venda });
  assert.equal(validar.mock.callCount(), 0);
  assert.equal(Venda.transaction.mock.callCount(), 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { montarAlteracoesAuditoria } = require('../src/utils/alteracoes-auditoria');
const { auditar } = require('../src/middlewares/audit.middleware');
const auditLogService = require('../src/services/audit-log.service');
const Usuario = require('../src/models/Usuario');
const usuarioService = require('../src/services/usuario.service');

test('compara data e valor salvos, ignora campos iguais e horários automáticos', () => {
  const antes = { id: 4, nome: 'Cliente', data_venda: '2026-08-27', valor_total: '100.00', updated_at: 'antigo' };
  const depois = { ...antes, data_venda: '2026-10-01', valor_total: '150.00', updated_at: 'novo' };
  assert.deepEqual(montarAlteracoesAuditoria(antes, depois), [
    { campo: 'data_venda', anterior: '2026-08-27', novo: '2026-10-01' },
    { campo: 'valor_total', anterior: '100.00', novo: '150.00' }
  ]);
});

test('detalha campos compostos, arrays, remoções e JSON persistido', () => {
  assert.deepEqual(montarAlteracoesAuditoria(
    { chips: '[{"quantidade":2,"valor_unitario":50}]', nome: 'Antes', ativo: false },
    { chips: [{ quantidade: 2, valor_unitario: 75 }], nome: null, ativo: true }
  ), [
    { campo: 'chips[0].valor_unitario', anterior: 50, novo: 75 },
    { campo: 'nome', anterior: 'Antes', novo: null },
    { campo: 'ativo', anterior: false, novo: true }
  ]);
  assert.deepEqual(montarAlteracoesAuditoria({ permissoes: '["vendas"]' }, { permissoes: ['vendas'] }), []);
});

test('valores protegidos não vazam nem em alterações aninhadas nem em logs antigos', () => {
  const diferencas = montarAlteracoesAuditoria(
    { senha: 'hash-antigo', credencial: { token: 'segredo-antigo' } },
    { senha: 'hash-novo', credencial: { token: 'segredo-novo' } }
  );
  assert.equal(diferencas.length, 2);
  assert.doesNotMatch(JSON.stringify(diferencas), /hash-|segredo-/);
  const antigo = auditLogService.sanitizar({ alteracoes_detalhadas: [{ campo: 'senha', anterior: 'antigo', novo: 'novo', token_extra: 'segredo-extra' }] });
  assert.equal(antigo.alteracoes_detalhadas[0].anterior, '[removido]');
  assert.equal(antigo.alteracoes_detalhadas[0].token_extra, '[removido]');
  assert.equal(auditLogService.sanitizar({ cliente_secreto_id: 3 }).cliente_secreto_id, 3);
});

function prepararRequisicao() {
  const req = { method: 'PUT', params: { id: 4 }, usuario: { id: 7 }, body: { nome: 'Novo', email: 'mesmo@teste.com' } };
  const res = { statusCode: 200, json(body) { return body; }, send(body) { return body; } };
  auditar({ acao: 'usuario.atualizado', entidade: 'usuarios', entidade_id: req => req.params.id,
    dados: req => ({ alteracoes: req.body }) })(req, res, () => {});
  return { req, res };
}

test('edição registra o estado anterior bloqueado e o valor efetivo dentro da transação, uma única vez', async () => {
  const original = { query: Usuario.query, transaction: Usuario.transaction, registrar: auditLogService.registrar, fallback: auditLogService.registrarSemBloquear };
  const trx = {};
  const registros = [];
  const ordem = [];
  Usuario.transaction = async callback => { const resultado = await callback(trx); ordem.push('commit'); return resultado; };
  Usuario.query = transaction => {
    assert.equal(transaction, trx);
    return {
      findById() { return this; },
      async forUpdate() { ordem.push('lock'); return { id: 4, nome: 'Antigo', email: 'mesmo@teste.com' }; },
      async patchAndFetchById(_id, patch) { ordem.push('update'); return { id: 4, nome: patch.nome.trim(), email: 'mesmo@teste.com' }; }
    };
  };
  auditLogService.registrar = async (req, registro, transaction) => {
    assert.equal(req.usuario.id, 7); assert.equal(transaction, trx); ordem.push('audit'); registros.push(registro);
  };
  auditLogService.registrarSemBloquear = async () => assert.fail('Auditoria duplicada');
  try {
    const { req, res } = prepararRequisicao();
    const atualizado = await usuarioService.atualizarUsuario(4, { ...req.body, nome: ' Novo ' }, { registrarAuditoria: req.registrarAlteracaoAuditoria });
    res.json(atualizado);
    assert.deepEqual(ordem, ['lock', 'update', 'audit', 'commit']);
    assert.equal(registros.length, 1);
    assert.deepEqual(registros[0].dados.alteracoes_detalhadas, [{ campo: 'nome', anterior: 'Antigo', novo: 'Novo' }]);
  } finally {
    Usuario.query = original.query; Usuario.transaction = original.transaction;
    auditLogService.registrar = original.registrar; auditLogService.registrarSemBloquear = original.fallback;
  }
});

test('falha ao gravar auditoria impede a confirmação da edição', async () => {
  const original = auditLogService.registrar;
  auditLogService.registrar = async () => { throw new Error('Falha de gravação'); };
  try {
    const { req } = prepararRequisicao();
    await assert.rejects(req.registrarAlteracaoAuditoria({ nome: 'Antigo' }, { nome: 'Novo' }, {}), /Falha de gravação/);
  } finally { auditLogService.registrar = original; }
});

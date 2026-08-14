const test = require('node:test');
const assert = require('node:assert/strict');

const { usuarioTemPermissaoLocal } = require('../src/utils/permissoes');

test('admin possui todas as permissoes', () => {
  const usuario = {
    ativo: true,
    role: { nome: 'admin' }
  };

  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_criar'), true);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_excluir'), true);
});

test('admin precisa de permissao explicita para visualizar recursos sensiveis', () => {
  const usuario = {
    ativo: true,
    role: {
      nome: 'admin',
      permissoes: { clientes_secretos_ver_todos: true, clientes_antigos_ver_historico: true }
    }
  };

  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_criar'), true);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_secretos_ver_todos'), false);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_antigos_ver_historico'), false);
  assert.equal(usuarioTemPermissaoLocal({
    ...usuario,
    permissoes: { clientes_secretos_ver_todos: true, clientes_antigos_ver_historico: true }
  }, 'clientes_secretos_ver_todos'), true);
  assert.equal(usuarioTemPermissaoLocal({
    ...usuario,
    permissoes: { clientes_secretos_ver_todos: true, clientes_antigos_ver_historico: true }
  }, 'clientes_antigos_ver_historico'), true);
});

test('admin precisa de permissao explicita para excluir reversoes', () => {
  const admin = { ativo: true, role: { nome: 'admin', permissoes: { vendas_excluir_reversoes: true } } };

  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_excluir_reversoes'), false);
  assert.equal(usuarioTemPermissaoLocal({
    ...admin,
    permissoes: { vendas_excluir_reversoes: true }
  }, 'vendas_excluir_reversoes'), true);
});

test('admin pode ter qualquer permissao negada explicitamente', () => {
  const usuario = {
    ativo: true,
    permissoes: {
      gerenciar_permissoes: false,
      notificacoes_receber_email: false,
      clientes_excluir: false
    },
    role: { nome: 'admin' }
  };

  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_criar'), true);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'gerenciar_permissoes'), false);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'notificacoes_receber_email'), false);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_excluir'), false);
});

test('admin respeita permissoes salvas como json duplamente serializado', () => {
  const usuario = {
    ativo: true,
    permissoes: '"{\\"clientes_excluir\\":false}"',
    role: { nome: 'admin' }
  };

  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_excluir'), false);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_criar'), true);
});

test('usuario comum soma permissoes proprias e da role', () => {
  const usuario = {
    ativo: true,
    permissoes: ['clientes_criar'],
    role: {
      nome: 'usuario',
      permissoes: { clientes_excluir: true, clientes_editar: true }
    }
  };

  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_criar'), true);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_editar'), true);
  assert.equal(usuarioTemPermissaoLocal(usuario, 'clientes_excluir'), true);
});

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
  assert.equal(usuarioTemPermissaoLocal(usuario, 'funil_automacoes'), false);
  assert.equal(usuarioTemPermissaoLocal({
    ...usuario,
    permissoes: { clientes_secretos_ver_todos: true, clientes_antigos_ver_historico: true }
  }, 'clientes_secretos_ver_todos'), true);
  assert.equal(usuarioTemPermissaoLocal({
    ...usuario,
    permissoes: { clientes_secretos_ver_todos: true, clientes_antigos_ver_historico: true }
  }, 'clientes_antigos_ver_historico'), true);
  assert.equal(usuarioTemPermissaoLocal({
    ...usuario,
    permissoes: { funil_automacoes: true }
  }, 'funil_automacoes'), true);
});

test('admin sempre possui controle integral de vendas apesar de negacoes locais', () => {
  const admin = {
    ativo: true,
    role: { nome: 'admin' },
    permissoes: {
      vendas_ver_todas: false,
      vendas_editar: false,
      vendas_excluir: false,
      vendas_excluir_reversoes: false,
      pos_venda: false,
      vendas_limitar_ultimos_6_meses: true
    }
  };

  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_ver_todas'), true);
  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_editar'), true);
  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_excluir'), true);
  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_excluir_reversoes'), true);
  assert.equal(usuarioTemPermissaoLocal(admin, 'pos_venda'), true);
  assert.equal(usuarioTemPermissaoLocal(admin, 'vendas_limitar_ultimos_6_meses'), false);
});

test('admin precisa de permissao explicita para configurar horario de acesso', () => {
  const admin = { ativo: true, role: { nome: 'admin' } };
  assert.equal(usuarioTemPermissaoLocal(admin, 'configurar_horario_acesso'), false);
  assert.equal(usuarioTemPermissaoLocal({
    ...admin,
    permissoes: { configurar_horario_acesso: true }
  }, 'configurar_horario_acesso'), true);
  assert.equal(usuarioTemPermissaoLocal({
    ...admin,
    permissoes: { configurar_horario_acesso: false }
  }, 'configurar_horario_acesso'), false);
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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const usuarioService = require('../src/services/usuario.service');
const authService = require('../src/services/auth.service');
const audit = require('../src/services/audit-log.service');
const horarios = require('../src/services/horario-acesso.service');
const { recuperarSenha } = require('../src/utils/senha-usuario');

const modelo = dados => Object.assign(new Usuario(), dados);
const conta = extras => ({ id: 1, nome: 'Ana', email: 'ana@teste.local', senha: 'hash-antigo', role_id: 1, role: { nome: 'admin' }, ativo: true, ...extras });

function bancoUsuarios(t, iniciais = []) {
  const registros = new Map(iniciais.map(dado => [dado.id, modelo(dado)]));
  const patches = [];
  t.mock.method(Usuario, 'query', () => {
    let id;
    let resultado;
    return {
      findById(valor) { id = Number(valor); return this; },
      where(_campo, valor) { resultado = [...registros.values()].find(item => item.email === valor); return this; },
      first() { return this; },
      forUpdate() { return this; },
      withGraphFetched() { return this; },
      insert(dados) {
        const usuario = modelo({ id: 10, ...dados, role: { nome: 'usuario', permissoes: [] } });
        registros.set(usuario.id, usuario);
        return Promise.resolve(usuario);
      },
      patchAndFetchById(valor, dados) {
        id = Number(valor);
        patches.push(dados);
        registros.set(id, modelo({ ...registros.get(id), ...dados }));
        return this;
      },
      then(resolve, reject) { return Promise.resolve(resultado === undefined ? registros.get(id) : resultado).then(resolve, reject); }
    };
  });
  t.mock.method(Usuario, 'transaction', async callback => {
    const snapshot = new Map(registros);
    try { return await callback({}); } catch (error) {
      registros.clear();
      snapshot.forEach((valor, id) => registros.set(id, valor));
      throw error;
    }
  });
  t.mock.method(Permissao, 'query', () => ({ where() { return this; }, orderBy: async () => [] }));
  return { registros, patches };
}

test.beforeEach(t => {
  const chaveAnterior = process.env.CRM_PASSWORD_VAULT_KEY;
  delete process.env.CRM_PASSWORD_VAULT_KEY;
  t.after(() => {
    if (chaveAnterior === undefined) delete process.env.CRM_PASSWORD_VAULT_KEY;
    else process.env.CRM_PASSWORD_VAULT_KEY = chaveAnterior;
  });
});

test('cadastro preserva bcrypt e ignora copia recuperavel injetada no payload', async t => {
  const banco = bancoUsuarios(t);
  const criado = await usuarioService.criarUsuario({ nome: 'João', email: 'joao@teste.local', senha: 'nova-senha', role_id: 2, senha_criptografada: 'cópia injetada' });
  assert.equal(await bcrypt.compare('nova-senha', criado.senha), true);
  assert.equal(banco.registros.size, 1);
  assert.equal(recuperarSenha(criado.senha_criptografada), 'nova-senha');
  assert.equal('senha_criptografada' in criado.toJSON(), false);
  assert.equal('senha' in criado.toJSON(), false);
  const registro = audit.sanitizar({ usuario: { ...criado }, payload: { senha: 'nova-senha' } });
  assert.equal(registro.usuario.senha, '[removido]');
  assert.ok(!JSON.stringify(registro).includes('nova-senha'));
});

for (const [nome, atualizar] of [['edição administrativa', usuarioService.atualizarUsuario], ['perfil', authService.atualizarPerfil]]) {
  test(`${nome} troca senha e ignora cópias reversíveis no payload`, async t => {
    const banco = bancoUsuarios(t, [conta()]);
    await atualizar(1, { senha: 'nova-senha', senha_criptografada: 'cópia injetada' });
    const atualizado = banco.registros.get(1);
    assert.equal(await bcrypt.compare('nova-senha', atualizado.senha), true);
    assert.equal(recuperarSenha(atualizado.senha_criptografada), 'nova-senha');
    await atualizar(1, { nome: 'Novo nome', senha: '', senha_criptografada: 'cópia injetada' });
    assert.equal(banco.registros.get(1).senha, atualizado.senha);
    assert.equal(banco.registros.get(1).senha_criptografada, atualizado.senha_criptografada);
    assert.equal('senha' in banco.patches[1], false);
    assert.equal('senha_criptografada' in banco.patches[1], false);
  });

  test(`${nome} reverte a senha quando a auditoria falha`, async t => {
    const banco = bancoUsuarios(t, [conta()]);
    await assert.rejects(atualizar(1, { senha: 'nova-senha' }, { registrarAuditoria: async () => { throw new Error('auditoria'); } }), /auditoria/);
    assert.equal(banco.registros.get(1).senha, 'hash-antigo');
  });
}

test('login com bcrypt continua funcionando sem chave e não grava cópia da senha', async t => {
  const senha = await bcrypt.hash('senha-antiga', 10);
  const banco = bancoUsuarios(t, [conta({ senha })]);
  t.mock.method(horarios, 'avaliarAcesso', async () => ({ permitido: true }));
  const login = await authService.login('ana@teste.local', 'senha-antiga');
  assert.ok(login.token);
  assert.equal('senha' in login.usuario, false);
  assert.equal('senha_criptografada' in login.usuario, false);
  assert.equal(banco.patches.length, 0);
  await assert.rejects(authService.login('ana@teste.local', 'senha-incorreta'), /E-mail ou senha inválidos/);
});

test('serialização continua ocultando cópias legadas antes da migration de remoção', () => {
  const usuario = modelo(conta({ senha_criptografada: 'cópia legada' }));
  assert.equal('senha' in usuario.toJSON(), false);
  assert.equal('senha_criptografada' in usuario.toJSON(), false);
});

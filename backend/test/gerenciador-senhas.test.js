const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const usuarioService = require('../src/services/usuario.service');
const authService = require('../src/services/auth.service');
const audit = require('../src/services/audit-log.service');
const horarios = require('../src/services/horario-acesso.service');
const cofre = require('../src/utils/cofre-senhas');
const service = require('../src/services/gerenciador-senhas.service');
const router = require('../src/routes/gerenciador-senhas.routes');
const usuarioController = require('../src/controllers/usuario.controller');
const authController = require('../src/controllers/auth.controller');

const modelo = dados => Object.assign(new Usuario(), dados);

function bancoUsuarios(t, iniciais = []) {
  const registros = new Map(iniciais.map(dado => [dado.id, modelo(dado)]));
  const patches = [];
  const selecoes = [];
  t.mock.method(Usuario, 'query', () => {
    let id;
    let resultado;
    const query = {
      findById(valor) { id = Number(valor); return this; },
      where(_campo, valor) { resultado = [...registros.values()].find(item => item.email === valor); return this; },
      first() { return this; },
      forUpdate() { return this; },
      select(...campos) { selecoes.push(campos); return this; },
      withGraphFetched() { return this; },
      modifiers() { return this; },
      orderBy() { resultado = [...registros.values()].sort((a, b) => a.nome.localeCompare(b.nome)); return this; },
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
    return query;
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
  return { registros, patches, selecoes };
}

const conta = extras => ({ id: 1, nome: 'Ana', email: 'ana@teste.local', senha: 'hash-antigo', role_id: 1, role: { nome: 'admin' }, ativo: true, ...extras });

test('cadastro grava hash e cópia juntos, serialização e auditoria removem ambos', async t => {
  const banco = bancoUsuarios(t);
  const criado = await usuarioService.criarUsuario({ nome: 'João', email: 'joao@teste.local', senha: 'nova-senha', role_id: 2 });
  assert.equal(await bcrypt.compare('nova-senha', criado.senha), true);
  assert.equal(cofre.descriptografarSenha(criado.senha_criptografada, criado.senha), 'nova-senha');
  assert.equal(banco.registros.size, 1);
  assert.equal('senha' in criado.toJSON(), false);
  assert.equal('senha_criptografada' in criado.toJSON(), false);
  const registro = audit.sanitizar({ usuario: { ...criado }, payload: { senha: 'nova-senha' } });
  assert.equal(registro.usuario.senha, '[removido]');
  assert.equal(registro.usuario.senha_criptografada, '[removido]');
  assert.ok(!JSON.stringify(registro).includes('nova-senha'));
});

for (const [nome, atualizar] of [['edição administrativa', usuarioService.atualizarUsuario], ['perfil', authService.atualizarPerfil]]) {
  test(`${nome} sincroniza hash e cópia e preserva ambos em edições sem senha`, async t => {
    const banco = bancoUsuarios(t, [conta()]);
    await atualizar(1, { senha: 'nova-senha' });
    const atualizado = banco.registros.get(1);
    assert.equal(await bcrypt.compare('nova-senha', atualizado.senha), true);
    assert.equal(cofre.descriptografarSenha(atualizado.senha_criptografada, atualizado.senha), 'nova-senha');
    const gravado = { ...atualizado };
    await atualizar(1, { nome: 'Novo nome', senha: '', senha_criptografada: 'cópia injetada' });
    assert.equal(banco.registros.get(1).senha, gravado.senha);
    assert.equal(banco.registros.get(1).senha_criptografada, gravado.senha_criptografada);
    assert.equal('senha' in banco.patches[1], false);
    assert.equal('senha_criptografada' in banco.patches[1], false);
  });

  test(`${nome} reverte ambos quando a auditoria da alteração falha`, async t => {
    const banco = bancoUsuarios(t, [conta()]);
    await assert.rejects(atualizar(1, { senha: 'nova-senha' }, { registrarAuditoria: async () => { throw new Error('auditoria'); } }), /auditoria/);
    assert.equal(banco.registros.get(1).senha, 'hash-antigo');
    assert.equal(banco.registros.get(1).senha_criptografada, undefined);
  });
}

test('sem chave, cadastro e trocas falham antes de gravar; login antigo e edições sem senha funcionam', async t => {
  const senha = await bcrypt.hash('senha-antiga', 10);
  const banco = bancoUsuarios(t, [conta({ senha })]);
  const chave = process.env.CRM_PASSWORD_VAULT_KEY;
  delete process.env.CRM_PASSWORD_VAULT_KEY;
  t.after(() => { process.env.CRM_PASSWORD_VAULT_KEY = chave; });
  t.mock.method(horarios, 'avaliarAcesso', async () => ({ permitido: true }));
  await assert.rejects(usuarioService.criarUsuario({ senha: 'nova' }), { status: 503 });
  await assert.rejects(usuarioService.atualizarUsuario(1, { senha: 'nova' }), { status: 503 });
  await assert.rejects(authService.atualizarPerfil(1, { senha: 'nova' }), { status: 503 });
  assert.equal(banco.patches.length, 0);
  assert.equal(banco.registros.size, 1);
  const login = await authService.login('ana@teste.local', 'senha-antiga');
  assert.ok(login.token);
  assert.equal('senha' in login.usuario, false);
  assert.equal('senha_criptografada' in login.usuario, false);
  await usuarioService.atualizarUsuario(1, { nome: 'Novo' });
  await authService.atualizarPerfil(1, { nome: 'Outro' });
  assert.equal(banco.registros.get(1).senha, senha);
  assert.equal(banco.registros.get(1).senha_criptografada, undefined);
});

test('listagem retorna só metadados ordenados, incluindo contas inativas e antigas', async t => {
  const banco = bancoUsuarios(t, [conta({ nome: 'Zeca', senha_disponivel: 1 }), conta({ id: 2, nome: 'Ana', ativo: false, senha_disponivel: 0 })]);
  const dados = await service.listar();
  assert.deepEqual(dados.map(item => item.nome), ['Ana', 'Zeca']);
  assert.deepEqual(Object.keys(dados[0]).sort(), ['id', 'nome', 'email', 'funcao', 'ativo', 'senha_disponivel'].sort());
  assert.equal(dados[0].ativo, false);
  assert.equal(dados[0].senha_disponivel, false);
  assert.equal(dados[1].senha_disponivel, true);
  assert.ok(!JSON.stringify(dados).includes('hash-antigo'));
  assert.deepEqual(banco.selecoes[0], ['id', 'nome', 'email', 'role_id', 'ativo']);
});

async function servidor(t, contas = [conta()]) {
  const banco = bancoUsuarios(t, contas);
  t.mock.method(horarios, 'avaliarAcesso', async () => ({ permitido: true }));
  const app = express();
  app.use('/api/admin/senhas', router);
  const server = await new Promise(resolve => {
    const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const token = jwt.sign({ id: 1, role_id: 1 }, process.env.JWT_SECRET);
  return { ...banco, token, consultar: (path = '', options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/admin/senhas${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } }) };
}

test('rotas recusam sessões ausentes, inválidas e expiradas com no-store', async t => {
  const api = await servidor(t);
  for (const authorization of ['', 'Bearer inválido', `Bearer ${jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: -1 })}`]) {
    const resposta = await api.consultar('', { headers: { Authorization: authorization } });
    assert.equal(resposta.status, 401);
    assert.equal(resposta.headers.get('cache-control'), 'no-store');
  }
});

test('rotas revalidam função e status mesmo com token administrativo anterior', async t => {
  const api = await servidor(t);
  for (const dados of [{ role: { nome: 'usuario' }, permissoes: ['usuarios_editar', 'crud_usuarios'] }, { ativo: false }, { ativo: 0 }]) {
    api.registros.set(1, modelo(conta(dados)));
    for (const [path, method] of [['', 'GET'], ['/2/revelar', 'POST']]) {
      const resposta = await api.consultar(path, { method });
      assert.equal(resposta.status, 403);
      assert.equal(resposta.headers.get('cache-control'), 'no-store');
    }
  }
  api.registros.delete(1);
  assert.equal((await api.consultar()).status, 403);
});

test('administrador revela inclusive outro admin inativo somente após auditoria', async t => {
  const hash = await bcrypt.hash('senha-alvo', 10);
  const api = await servidor(t, [conta(), conta({ id: 2, ativo: false, senha: hash, senha_criptografada: cofre.criptografarSenha('senha-alvo', hash) })]);
  let confirmar;
  let iniciou;
  const inicio = new Promise(resolve => { iniciou = resolve; });
  const confirmacao = new Promise(resolve => { confirmar = resolve; });
  const registros = [];
  t.mock.method(audit, 'registrar', async (req, registro) => {
    registros.push({ administrador: req.usuario.id, ...registro });
    iniciou();
    await confirmacao;
  });
  let respondeu = false;
  const consulta = api.consultar('/2/revelar', { method: 'POST' }).then(resposta => { respondeu = true; return resposta; });
  await inicio;
  assert.equal(respondeu, false);
  confirmar();
  const resposta = await consulta;
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await resposta.json(), { senha: 'senha-alvo' });
  assert.equal(registros[0].administrador, 1);
  assert.equal(registros[0].acao, 'usuario.senha_visualizada');
  assert.equal(registros[0].entidade_id, 2);
  assert.deepEqual(registros[0].dados, { usuario_consultado_id: 2 });
  assert.ok(!JSON.stringify(registros).includes('senha-alvo'));
});

test('falhas de auditoria, criptografia e dados retornam erro sem revelar conteúdo', async t => {
  const api = await servidor(t, [conta(), conta({ id: 2 })]);
  assert.equal((await api.consultar('/999/revelar', { method: 'POST' })).status, 404);
  assert.equal((await api.consultar('/2/revelar', { method: 'POST' })).status, 409);
  assert.equal((await api.consultar('/abc/revelar', { method: 'POST' })).status, 400);
  const registro = cofre.criptografarSenha('senha-alvo', 'hash-antigo');
  api.registros.get(2).senha_criptografada = registro;
  t.mock.method(audit, 'registrar', async () => { throw new Error(`erro sensível ${registro}`); });
  const resposta = await api.consultar('/2/revelar', { method: 'POST' });
  assert.equal(resposta.status, 503);
  assert.deepEqual(await resposta.json(), { message: 'Gerenciador de senhas temporariamente indisponível.' });
  api.registros.get(2).senha_criptografada = 'registro corrompido';
  assert.equal((await api.consultar('/2/revelar', { method: 'POST' })).status, 503);
});

test('GET administrativo permite acesso sem permissões CRUD e não inclui segredos', async t => {
  const api = await servidor(t, [conta({ senha_disponivel: 0, permissoes: { usuarios_listar: false } })]);
  const resposta = await api.consultar();
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('cache-control'), 'no-store');
  const body = await resposta.json();
  assert.equal('senha' in body[0], false);
  assert.equal('senha_criptografada' in body[0], false);
});

test('controllers de cadastro e troca preservam HTTP 503 do cofre', async t => {
  t.mock.method(usuarioService, 'criarUsuario', async () => { throw cofre.erroCofre(); });
  t.mock.method(usuarioService, 'atualizarUsuario', async () => { throw cofre.erroCofre(); });
  t.mock.method(authService, 'atualizarPerfil', async () => { throw cofre.erroCofre(); });
  t.mock.method(console, 'error', () => {});
  for (const controller of [usuarioController.store, usuarioController.update, authController.updateMe]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await controller({ body: { senha: 'senha-teste' }, params: { id: '1' }, usuario: { id: 1 } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.message, cofre.erroCofre().message);
  }
});

test('migration adiciona coluna nullable sem modificar contas existentes', async () => {
  const migration = require('../src/database/migrations/20261013120000_add_senha_criptografada_to_usuarios');
  const operacoes = [];
  const knex = { schema: { alterTable(nome, callback) {
    assert.equal(nome, 'usuarios');
    callback({ text(campo) { operacoes.push(['text', campo]); return { nullable() { operacoes.push(['nullable']); } }; }, dropColumn(campo) { operacoes.push(['drop', campo]); } });
  } } };
  await migration.up(knex);
  await migration.down(knex);
  assert.deepEqual(operacoes, [['text', 'senha_criptografada'], ['nullable'], ['drop', 'senha_criptografada']]);
});

test('seed administrativo remove cópia anterior quando redefine o hash', async () => {
  const seed = require('../src/database/seeds/002_admin_user');
  let patch;
  const knex = tabela => ({ where() { return this; }, first: async () => tabela === 'roles' ? { id: 1 } : { id: 1 }, update: async dados => { patch = dados; } });
  knex.fn = { now: () => 'agora' };
  await seed.seed(knex);
  assert.equal(patch.senha_criptografada, null);
  assert.equal(await bcrypt.compare('admin123', patch.senha), true);
});

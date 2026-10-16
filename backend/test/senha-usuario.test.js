const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const express = require('express');
const jwt = require('jsonwebtoken');
const { prepararSenha, recuperarSenha } = require('../src/utils/senha-usuario');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const usuarioService = require('../src/services/usuario.service');
const authService = require('../src/services/auth.service');
const controller = require('../src/controllers/usuario.controller');
const authController = require('../src/controllers/auth.controller');
const auditoria = require('../src/services/audit-log.service');
const horario = require('../src/services/horario-acesso.service');

const chaveTeste = Buffer.alloc(32, 7).toString('base64');

test('migration adiciona coluna recuperável opcional sem alterar registros existentes', async () => {
  const knex = require('knex')({ client: 'mysql2' });
  const migration = require('../src/database/migrations/20261014120000_add_senha_criptografada_usuarios');
  try {
    const sql = migration.up(knex).toSQL();
    assert.equal(sql.length, 1);
    assert.match(sql[0].sql, /alter table `usuarios` add `senha_criptografada` text null/);
    assert.match(migration.down(knex).toSQL()[0].sql, /drop `senha_criptografada`/);
  } finally { await knex.destroy(); }
});

function response() {
  return {
    statusCode: 200, headers: {},
    set(nome, valor) { this.headers[nome] = valor; return this; },
    status(valor) { this.statusCode = valor; return this; },
    json(valor) { this.body = valor; return this; }
  };
}

test('criptografia autenticada usa nonce aleatório e preserva bcrypt', async () => {
  const senha = 'Sênha 🔐 com espaços ';
  const a = await prepararSenha(senha);
  const b = await prepararSenha(senha);
  assert.notEqual(a.senha_criptografada, b.senha_criptografada);
  assert.equal(recuperarSenha(a.senha_criptografada), senha);
  assert.equal(await bcrypt.compare(senha, a.senha), true);
  assert.equal(a.senha_criptografada.includes(senha), false);
  const partes = a.senha_criptografada.split(':');
  const adulterado = Buffer.from(partes[3], 'base64');
  adulterado[0] ^= 1;
  partes[3] = adulterado.toString('base64');
  assert.throws(() => recuperarSenha(partes.join(':')), /Não foi possível/);
  assert.throws(() => recuperarSenha('v0:inválido'), /Não foi possível/);
});

test('chaves ausentes, inválidas ou diferentes não permitem recuperação', async () => {
  const preparado = await prepararSenha('segredo-teste');
  try {
    for (const chave of ['', 'inválida', Buffer.alloc(31).toString('base64'), `${chaveTeste}\n`]) {
      process.env.USUARIO_SENHA_ENCRYPTION_KEY = chave;
      await assert.rejects(prepararSenha('segredo-teste'), /Chave/);
      assert.throws(() => recuperarSenha(preparado.senha_criptografada), /Não foi possível/);
    }
    process.env.USUARIO_SENHA_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    assert.throws(() => recuperarSenha(preparado.senha_criptografada), /Não foi possível/);
  } finally { process.env.USUARIO_SENHA_ENCRYPTION_KEY = chaveTeste; }
});

function bancoEmMemoria(t) {
  let usuario;
  const gravacoes = [];
  t.mock.method(Usuario, 'transaction', async callback => callback({}));
  t.mock.method(Usuario, 'query', () => {
    const query = {
      findById() { return this; }, forUpdate() { return this; },
      withGraphFetched() { return this; }, where() { return this; }, first() { return this; },
      then(resolve, reject) { return Promise.resolve(usuario).then(resolve, reject); },
      insert(dados) {
        gravacoes.push(dados);
        usuario = Usuario.fromJson({ id: 2, ...dados, role: { nome: 'usuario', permissoes: {} } });
        return this;
      },
      patchAndFetchById(_id, dados) {
        gravacoes.push(dados);
        usuario = Usuario.fromJson({ ...usuario, ...dados });
        return this;
      }
    };
    return query;
  });
  t.mock.method(Permissao, 'query', () => ({ where() { return this; }, orderBy: async () => [] }));
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: true }));
  return { gravacoes, get usuario() { return usuario; } };
}

test('cadastro e ambas as trocas persistem o par; senha vazia preserva e respostas ocultam segredos', async t => {
  const banco = bancoEmMemoria(t);
  const criado = await usuarioService.criarUsuario({ nome: 'Ana', email: 'ana@teste.com', role_id: 2, senha: 'primeira' });
  assert.equal(recuperarSenha(banco.usuario.senha_criptografada), 'primeira');
  assert.equal(await bcrypt.compare('primeira', banco.usuario.senha), true);
  assert.equal('senha' in criado.toJSON(), false);
  assert.equal('senha_criptografada' in criado.toJSON(), false);
  const atualizado = await usuarioService.atualizarUsuario(2, { senha: 'segunda' });
  assert.equal(recuperarSenha(atualizado.senha_criptografada), 'segunda');
  assert.equal(await bcrypt.compare('segunda', atualizado.senha), true);
  const perfil = await authService.atualizarPerfil(2, { senha: 'terceira' });
  assert.equal(recuperarSenha(banco.usuario.senha_criptografada), 'terceira');
  assert.equal(await bcrypt.compare('terceira', banco.usuario.senha), true);
  assert.equal('senha_criptografada' in perfil, false);
  assert.equal('senha' in perfil, false);
  const anterior = { senha: banco.usuario.senha, senha_criptografada: banco.usuario.senha_criptografada };
  await usuarioService.atualizarUsuario(2, { senha: '', nome: 'Ana nova' });
  await authService.atualizarPerfil(2, { senha: '' });
  assert.equal(banco.usuario.senha, anterior.senha);
  assert.equal(banco.usuario.senha_criptografada, anterior.senha_criptografada);
  assert.equal('senha' in banco.gravacoes.at(-1), false);
  assert.equal('senha_criptografada' in banco.gravacoes.at(-1), false);
  const login = await authService.login('ana@teste.com', 'terceira');
  assert.equal('senha' in login.usuario, false);
  assert.equal('senha_criptografada' in login.usuario, false);
  const sanitizado = auditoria.sanitizar({ usuario: { ...banco.usuario }, alteracoes: banco.gravacoes });
  assert.equal(JSON.stringify(sanitizado).includes(anterior.senha_criptografada), false);
  assert.equal(JSON.stringify(sanitizado).includes(anterior.senha), false);
});

test('sem chave, nenhum fluxo grava parcialmente e login antigo continua funcionando', async t => {
  const banco = bancoEmMemoria(t);
  await usuarioService.criarUsuario({ nome: 'Ana', email: 'ana@teste.com', role_id: 2, senha: 'antiga' });
  banco.usuario.senha_criptografada = null;
  banco.gravacoes.length = 0;
  try {
    delete process.env.USUARIO_SENHA_ENCRYPTION_KEY;
    await assert.rejects(usuarioService.criarUsuario({ senha: 'nova' }), /Chave/);
    await assert.rejects(usuarioService.atualizarUsuario(2, { senha: 'nova' }), /Chave/);
    await assert.rejects(authService.atualizarPerfil(2, { senha: 'nova' }), /Chave/);
    assert.equal(banco.gravacoes.length, 0);
    assert.equal((await authService.login('ana@teste.com', 'antiga')).usuario.id, 2);
    assert.equal(banco.usuario.senha_criptografada, null);
  } finally { process.env.USUARIO_SENHA_ENCRYPTION_KEY = chaveTeste; }
});

test('consulta retorna 404/409 e exige auditoria antes de responder, sem expor erros', async t => {
  let usuario;
  const eventos = [];
  t.mock.method(usuarioService, 'buscarUsuarioPorId', async () => usuario);
  t.mock.method(auditoria, 'registrar', async (req, evento) => {
    assert.equal(req.usuario.id, 7);
    assert.deepEqual(evento.dados, { usuario_consultado_id: 2 });
    assert.equal(evento.acao, 'usuario.senha_visualizada');
    eventos.push('auditoria');
  });
  const req = { params: { id: 2 }, usuario: { id: 7 } };
  const ausente = response();
  await controller.visualizarSenha(req, ausente);
  assert.equal(ausente.statusCode, 404);
  usuario = { id: 2, senha_criptografada: null };
  const antiga = response();
  await controller.visualizarSenha(req, antiga);
  assert.equal(antiga.statusCode, 409);
  assert.equal(antiga.body.code, 'SENHA_NAO_DISPONIVEL');
  assert.equal(eventos.length, 0);
  usuario = { id: 2, ...await prepararSenha('segredo-consulta') };
  const sucesso = response();
  sucesso.json = body => { eventos.push('resposta'); sucesso.body = body; };
  await controller.visualizarSenha(req, sucesso);
  assert.deepEqual(eventos, ['auditoria', 'resposta']);
  assert.deepEqual(sucesso.body, { senha: 'segredo-consulta' });
  assert.equal(sucesso.headers['Cache-Control'], 'no-store');
  t.mock.method(auditoria, 'registrar', async () => { throw new Error('segredo-consulta'); });
  const falha = response();
  await controller.visualizarSenha(req, falha);
  assert.equal(falha.statusCode, 500);
  assert.equal(JSON.stringify(falha.body).includes('segredo-consulta'), false);
  usuario.senha_criptografada = 'adulterado';
  const corrompida = response();
  await controller.visualizarSenha(req, corrompida);
  assert.equal(corrompida.statusCode, 500);
});

test('rota real exige autenticação, edição e proteção de administradores', async t => {
  const alvo = Usuario.fromJson({ id: 2, nome: 'Ana', email: 'ana@teste.com', role_id: 2,
    ativo: true, ...await prepararSenha('senha-rota'), role: { nome: 'usuario', permissoes: {} } });
  const solicitante = { id: 7, ativo: true, role: { nome: 'usuario' }, permissoes: [] };
  t.mock.method(Usuario, 'query', () => ({
    findById(id) { this.id = Number(id); return this; },
    withGraphFetched() { return Promise.resolve(this.id === 7 ? solicitante : alvo); }
  }));
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: true }));
  let registros = 0;
  t.mock.method(auditoria, 'registrar', async () => { registros++; });
  const app = express();
  app.use(express.json());
  app.use('/usuarios', require('../src/routes/usuario.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/usuarios/2/visualizar-senha`;
  const token = jwt.sign({ id: 7 }, process.env.JWT_SECRET);
  const consultar = (autenticado = true) => fetch(url, { method: 'POST',
    headers: autenticado ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await consultar(false)).status, 401);
  for (const permissao of ['usuarios_listar', 'gerenciar_permissoes']) {
    solicitante.permissoes = [permissao];
    assert.equal((await consultar()).status, 403);
  }
  solicitante.permissoes = ['usuarios_editar'];
  solicitante.ativo = false;
  assert.equal((await consultar()).status, 403);
  solicitante.ativo = true;
  alvo.role.nome = 'admin';
  assert.equal((await consultar()).status, 403);
  assert.equal(registros, 0);
  alvo.role.nome = 'usuario';
  const sucesso = await consultar();
  assert.equal(sucesso.status, 200);
  assert.equal(sucesso.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await sucesso.json(), { senha: 'senha-rota' });
  solicitante.role.nome = 'admin';
  alvo.role.nome = 'admin';
  assert.equal((await consultar()).status, 200);
  assert.equal(registros, 2);
});

test('erros de persistência não expõem senha ou cópia em logs e respostas', async t => {
  const erro = new Error('SQL contendo senha_criptografada e segredo-teste');
  t.mock.method(usuarioService, 'criarUsuario', async () => { throw erro; });
  t.mock.method(usuarioService, 'atualizarUsuario', async () => { throw erro; });
  t.mock.method(authService, 'atualizarPerfil', async () => { throw erro; });
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const req = { body: { senha: 'segredo-teste' }, params: { id: 2 }, usuario: { id: 2 } };
  for (const handler of [controller.store, controller.update, authController.updateMe]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.stringify(res.body).includes('segredo-teste'), false);
  }
  assert.equal(JSON.stringify(logs).includes('segredo-teste'), false);
  assert.equal(JSON.stringify(logs).includes('senha_criptografada'), false);
});

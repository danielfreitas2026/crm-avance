const test = require('node:test');
const assert = require('node:assert/strict');

const authController = require('../src/controllers/auth.controller');
const authService = require('../src/services/auth.service');
const auditLogService = require('../src/services/audit-log.service');
const authMiddleware = require('../src/middlewares/auth.middleware');
const permissoes = require('../src/middlewares/permissao.middleware');
const Usuario = require('../src/models/Usuario');
const horarioAcessoService = require('../src/services/horario-acesso.service');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

test('auth controller valida credenciais, registra auditoria e responde a login', async () => {
  const res = response();
  const registros = [];
  auditLogService.registrarSemBloquear = async (_req, dados) => registros.push(dados);
  authService.login = async (email, senha) => ({ token: 'jwt', usuario: { id: 7, email, senha } });

  await authController.login({ body: {} }, res);
  assert.equal(res.statusCode, 400);

  const sucesso = response();
  await authController.login({ body: { email: 'ana@teste.com', senha: 'segredo' } }, sucesso);
  assert.equal(sucesso.statusCode, 200);
  assert.equal(sucesso.body.token, 'jwt');
  assert.equal(registros[0].acao, 'auth.login');
});

test('auth controller trata falha de login e atualizacao de perfil', async () => {
  auditLogService.registrarSemBloquear = async () => {};
  authService.login = async () => { throw new Error('Credenciais inválidas'); };
  const falha = response();
  await authController.login({ body: { email: 'ana@teste.com', senha: 'errada' } }, falha);
  assert.equal(falha.statusCode, 401);
  assert.equal(falha.body.message, 'Credenciais inválidas');

  authService.buscarUsuarioLogado = async id => ({ id, nome: 'Ana' });
  const me = response();
  await authController.me({ usuario: { id: 7 } }, me);
  assert.deepEqual(me.body, { id: 7, nome: 'Ana' });

  authService.atualizarPerfil = async (id, dados) => ({ id, ...dados });
  const perfil = response();
  await authController.updateMe({ usuario: { id: 7 }, body: { nome: 'Ana', foto_perfil: 'base64' } }, perfil);
  assert.equal(perfil.body.id, 7);
});

test('auth controller preserva status e código de sistema fechado', async () => {
  auditLogService.registrarSemBloquear = async () => {};
  authService.login = async () => {
    const error = new Error('Sistema fechado');
    error.status = 423;
    error.code = 'SYSTEM_CLOSED';
    throw error;
  };
  const res = response();
  await authController.login({ body: { email: 'ana@teste.com', senha: 'segredo' } }, res);
  assert.equal(res.statusCode, 423);
  assert.equal(res.body.code, 'SYSTEM_CLOSED');
});

test('auth middleware aceita token valido e rejeita cabecalhos invalidos', async () => {
  const semToken = response();
  authMiddleware({ headers: {} }, semToken, () => assert.fail('next não deveria ser chamado'));
  assert.equal(semToken.statusCode, 401);

  const malformado = response();
  authMiddleware({ headers: { authorization: 'Bearer' } }, malformado, () => assert.fail('next não deveria ser chamado'));
  assert.equal(malformado.statusCode, 401);

  let proximo = false;
  const jwt = require('jsonwebtoken');
  const originalVerify = jwt.verify;
  const originalAvaliarAcesso = horarioAcessoService.avaliarAcesso;
  jwt.verify = () => ({ id: 3 });
  horarioAcessoService.avaliarAcesso = async () => ({ permitido: true });
  const req = { headers: { authorization: 'Bearer valido' } };
  await authMiddleware(req, response(), () => { proximo = true; });
  jwt.verify = originalVerify;
  horarioAcessoService.avaliarAcesso = originalAvaliarAcesso;
  assert.equal(proximo, true);
  assert.deepEqual(req.usuario, { id: 3 });
});

test('middlewares de permissao bloqueiam, permitem e impedem autoexclusao', async () => {
  const originalQuery = Usuario.query;
  const criarQuery = usuario => () => ({
    findById() { return this; },
    withGraphFetched: async () => usuario
  });

  Usuario.query = criarQuery({ id: 2, ativo: true, role: { nome: 'usuario' }, permissoes: { clientes_ver: true } });
  let next = false;
  await permissoes.exigirPermissao('clientes_ver')({ usuario: { id: 2 } }, response(), () => { next = true; });
  assert.equal(next, true);

  const bloqueado = response();
  await permissoes.exigirPermissao('clientes_excluir')({ usuario: { id: 2 } }, bloqueado, () => assert.fail('next não deveria ser chamado'));
  assert.equal(bloqueado.statusCode, 403);

  const proprio = response();
  permissoes.impedirAutoExclusao({ params: { id: '2' }, usuario: { id: 2 } }, proprio, () => assert.fail('next não deveria ser chamado'));
  assert.equal(proprio.statusCode, 403);

  let administrador = false;
  Usuario.query = criarQuery({ id: 2, role: { nome: 'admin' } });
  await permissoes.exigirAdmin({ usuario: { id: 2 } }, response(), () => { administrador = true; });
  assert.equal(administrador, true);
  Usuario.query = originalQuery;
});

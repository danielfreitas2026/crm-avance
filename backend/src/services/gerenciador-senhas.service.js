const Usuario = require('../models/Usuario');
const auditLogService = require('./audit-log.service');
const { descriptografarSenha } = require('../utils/cofre-senhas');

async function listar() {
  const usuarios = await Usuario.query()
    .select('id', 'nome', 'email', 'role_id', 'ativo')
    .select(Usuario.raw('senha_criptografada IS NOT NULL AS senha_disponivel'))
    .withGraphFetched('role(selectNome)')
    .modifiers({ selectNome: query => query.select('id', 'nome') })
    .orderBy('nome', 'asc');

  return usuarios.map(usuario => ({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    funcao: usuario.role?.nome || null,
    ativo: usuario.estaAtivo(),
    senha_disponivel: Boolean(usuario.senha_disponivel)
  }));
}

async function revelar(id, req) {
  const usuario = await Usuario.query().findById(id).select('id', 'senha', 'senha_criptografada');
  if (!usuario) {
    const error = new Error('Usuário não encontrado.');
    error.status = 404;
    throw error;
  }
  if (!usuario.senha_criptografada) {
    const error = new Error('Senha indisponível até a próxima troca.');
    error.status = 409;
    throw error;
  }
  const senha = descriptografarSenha(usuario.senha_criptografada, usuario.senha);
  await auditLogService.registrar(req, {
    acao: 'usuario.senha_visualizada',
    entidade: 'usuarios',
    entidade_id: usuario.id,
    dados: { usuario_consultado_id: usuario.id }
  });
  return { senha };
}

module.exports = { listar, revelar };

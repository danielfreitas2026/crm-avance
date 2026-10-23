/**
 * Servico de autenticacao, emissao de token e manutencao do perfil logado.
 */
const bcrypt = require('bcrypt');
const { prepararSenha } = require('../utils/senha-usuario');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const acessoRede = require('./acesso-rede.service');

const Usuario = require('../models/Usuario');
const { montarMapaPermissoesEfetivas } = require('../utils/permissoes');
const horarioAcessoService = require('./horario-acesso.service');
const recuperacao = require('./recuperacao-conta.service');

/**
 * Valida foto perfil e retorna o resultado esperado.
 */
function validarFotoPerfil(fotoPerfil) {
  if (fotoPerfil === null || fotoPerfil === '') {
    return null;
  }

  if (typeof fotoPerfil !== 'string') {
    throw new Error('Foto de perfil invalida.');
  }

  const formatoValido = /^data:image\/(png|jpe?g|webp);base64,/i.test(fotoPerfil);

  if (!formatoValido) {
    throw new Error('A foto deve ser PNG, JPG ou WEBP.');
  }

  const tamanhoMaximo = 6 * 1024 * 1024;

  if (Buffer.byteLength(fotoPerfil, 'utf8') > tamanhoMaximo) {
    throw new Error('A foto deve ter ate 4 MB.');
  }

  return fotoPerfil;
}

/**
 * Monta usuario com permissoes a partir dos dados informados.
 */
async function montarUsuarioComPermissoes(usuario, perfil = false) {
  const usuarioJson = usuario.toJSON();

  return {
    ...usuarioJson,
    ...(perfil ? recuperacao.dadosPerfil(usuario) : {}),
    permissoes: await montarMapaPermissoesEfetivas(usuario)
  };
}

/**
 * Atualiza perfil com os dados informados.
 */
async function atualizarPerfil(usuarioId, dados, { registrarAuditoria } = {}) {
  const dadosAtualizacao = {};

  if (dados.nome !== undefined) {
    dadosAtualizacao.nome = dados.nome;
  }

  if (dados.email !== undefined) {
    dadosAtualizacao.email = dados.email;
  }

  if (dados.senha !== undefined && dados.senha !== '') {
    Object.assign(dadosAtualizacao, await prepararSenha(dados.senha));
  }

  if (dados.foto_perfil !== undefined) {
    dadosAtualizacao.foto_perfil = validarFotoPerfil(dados.foto_perfil);
  }

  const usuario = await Usuario.transaction(async trx => {
    const usuarioAtual = await Usuario.query(trx).findById(usuarioId).forUpdate().withGraphFetched('role');
    if (!usuarioAtual) throw new Error('Usuário não encontrado.');
    if (dados.email_recuperacao !== undefined) {
      Object.assign(dadosAtualizacao, await recuperacao.configurarEmail(
        trx, usuarioAtual, dados.email_recuperacao, dados.senha_atual
      ));
    }
    if (dadosAtualizacao.senha) await recuperacao.invalidarTokens(trx, usuarioId, 'redefinicao');
    if (dados.permissoes !== undefined && usuarioAtual.role?.nome === 'admin') {
      dadosAtualizacao.permissoes = JSON.stringify(dados.permissoes || []);
    }
    const atualizado = await Usuario.query(trx).patchAndFetchById(usuarioId, dadosAtualizacao).withGraphFetched('role');
    if (registrarAuditoria) {
      const antes = { ...usuarioAtual };
      const depois = { ...atualizado };
      delete antes.role;
      delete depois.role;
      await registrarAuditoria(antes, depois, trx);
    }
    return atualizado;
  });
  return montarUsuarioComPermissoes(usuario, true);
}

/**
 * Processa login conforme as regras do dominio.
 */
async function login(email, senha, req) {
  
  const usuario = await Usuario.query()
    .where('email', email)
    .withGraphFetched('role')
    .first();



  if (!usuario) {
    throw new Error('E-mail ou senha inválidos.');
  }

  if (!usuario.ativo) {
    throw new Error('Usuário inativo.');
  }

  const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

  if (!senhaCorreta) {
    throw new Error('E-mail ou senha inválidos.');
  }

  const acesso = await horarioAcessoService.avaliarAcesso(usuario.id);
  if (!acesso.permitido && acesso.motivo === 'SYSTEM_CLOSED') {
    const error = new Error(horarioAcessoService.SYSTEM_CLOSED_MESSAGE);
    error.code = 'SYSTEM_CLOSED';
    error.status = 423;
    throw error;
  }

  await acessoRede.avaliar(usuario, req);
  return criarSessao(usuario);
}

async function criarSessao(usuario, { sessaoId = randomUUID(), expiraEm, acessoPorCodigo = false } = {}) {
  const preservarExpiracao = expiraEm && !acessoPorCodigo;
  let token = jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      role_id: usuario.role_id,
      versao_sessao: usuario.versao_sessao || 0,
      jti: sessaoId,
      ...(acessoPorCodigo ? { acesso_por_codigo: true } : {}),
      ...(preservarExpiracao ? { exp: expiraEm } : {})
    },
    process.env.JWT_SECRET,
    {
      ...(preservarExpiracao ? {} : { expiresIn: process.env.JWT_EXPIRES_IN || '1d' })
    }
  );

  if (acessoPorCodigo) {
    // O JWT calcula a duração configurada. O código só pode reduzi-la,
    // preservando também o prazo de uma sessão que já estava em andamento.
    const claims = jwt.decode(token);
    const exp = Math.min(claims.exp, claims.iat + 2 * 60 * 60, expiraEm ?? Infinity);
    if (exp !== claims.exp) token = jwt.sign({ ...claims, exp }, process.env.JWT_SECRET);
  }

  return {
    token,
    usuario: await montarUsuarioComPermissoes(usuario)
  };
}

/**
 * Busca usuario logado conforme os parametros informados.
 */
async function buscarUsuarioLogado(usuarioId) {
  const usuario = await Usuario.query()
    .findById(usuarioId)
    .withGraphFetched('role');

  if (!usuario) {
    throw new Error('Usuário não encontrado.');
  }

  if (!usuario.ativo) {
    throw new Error('Usuário inativo.');
  }

  return await montarUsuarioComPermissoes(usuario, true);
}

module.exports = {
  criarSessao,
  login,
  buscarUsuarioLogado,
  atualizarPerfil
};

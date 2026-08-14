/**
 * Servico de autenticacao, emissao de token e manutencao do perfil logado.
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Usuario = require('../models/Usuario');
const { montarMapaPermissoesEfetivas } = require('../utils/permissoes');
const horarioAcessoService = require('./horario-acesso.service');

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
async function montarUsuarioComPermissoes(usuario) {
  const usuarioJson = usuario.toJSON();

  return {
    ...usuarioJson,
    permissoes: await montarMapaPermissoesEfetivas(usuario)
  };
}

/**
 * Atualiza perfil com os dados informados.
 */
async function atualizarPerfil(usuarioId, dados) {
  const dadosAtualizacao = {};

  if (dados.nome !== undefined) {
    dadosAtualizacao.nome = dados.nome;
  }

  if (dados.email !== undefined) {
    dadosAtualizacao.email = dados.email;
  }

  if (dados.senha !== undefined && dados.senha !== '') {
    dadosAtualizacao.senha = await bcrypt.hash(dados.senha, 10);
  }

  if (dados.foto_perfil !== undefined) {
    dadosAtualizacao.foto_perfil = validarFotoPerfil(dados.foto_perfil);
  }

  if (dados.permissoes !== undefined) {
    const usuarioAtual = await Usuario.query()
      .findById(usuarioId)
      .withGraphFetched('role');

    if (usuarioAtual?.role?.nome === 'admin') {
      dadosAtualizacao.permissoes = JSON.stringify(dados.permissoes || []);
    }
  }

  const usuario = await Usuario.query()
    .patchAndFetchById(usuarioId, dadosAtualizacao)
    .withGraphFetched('role');

  return montarUsuarioComPermissoes(usuario);
}

/**
 * Processa login conforme as regras do dominio.
 */
async function login(email, senha) {
  
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

  const token = jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      role_id: usuario.role_id
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    }
  );

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

  return await montarUsuarioComPermissoes(usuario);
}

module.exports = {
  login,
  buscarUsuarioLogado,
  atualizarPerfil
};

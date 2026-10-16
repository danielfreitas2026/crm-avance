const Usuario = require('../models/Usuario');
/**
 * Servico de usuarios, roles e permissoes efetivas.
 */
const { prepararSenha } = require('../utils/senha-usuario');


/**
 * Lista usuarios conforme os filtros e parametros informados.
 */
async function listarUsuarios() {
  return Usuario.query()
    .withGraphFetched('role')
    .orderBy('nome', 'asc');
}

/**
 * Busca usuario por id conforme os parametros informados.
 */
async function buscarUsuarioPorId(id) {
  return Usuario.query()
    .findById(id)
    .withGraphFetched('role');
}

/**
 * Cria usuario com os dados informados.
 */
async function criarUsuario(dados) {
  const senhaPreparada = await prepararSenha(dados.senha);

  return Usuario.query().insert({
    nome: dados.nome,
    email: dados.email,
    ...senhaPreparada,
    role_id: dados.role_id,
    permissoes: JSON.stringify(dados.permissoes || []),
    ativo: dados.ativo ?? true
  });
}

/**
 * Atualiza usuario com os dados informados.
 */
async function atualizarUsuario(id, dados, { registrarAuditoria } = {}) {
  const dadosAtualizacao = {};

  if (dados.permissoes !== undefined) {
    dadosAtualizacao.permissoes = JSON.stringify(dados.permissoes || []);
  }

  if (dados.nome !== undefined) {
    dadosAtualizacao.nome = dados.nome;
  }

  if (dados.email !== undefined) {
    dadosAtualizacao.email = dados.email;
  }

  if (dados.role_id !== undefined) {
    dadosAtualizacao.role_id = dados.role_id;
  }

  if (dados.ativo !== undefined) {
    dadosAtualizacao.ativo = dados.ativo;
  }

  if (dados.senha !== undefined && dados.senha !== '') {
    Object.assign(dadosAtualizacao, await prepararSenha(dados.senha));
  }

  return Usuario.transaction(async trx => {
    const anterior = await Usuario.query(trx).findById(id).forUpdate();
    if (!anterior) return null;
    const atualizado = await Usuario.query(trx).patchAndFetchById(id, dadosAtualizacao);
    if (registrarAuditoria) await registrarAuditoria({ ...anterior }, { ...atualizado }, trx);
    return atualizado;
  });
}

/**
 * Exclui usuario conforme a regra de negocio.
 */
async function excluirUsuario(id) {
  return Usuario.transaction(async trx => {
    const usuario = await Usuario.query(trx).findById(id).select('id', 'nome');
    if (!usuario) return 0;

    await trx('lead_atribuicoes')
      .where('usuario_id', usuario.id)
      .update({
        usuario_id_historico: usuario.id,
        usuario_nome_historico: usuario.nome
      });

    return Usuario.query(trx).deleteById(usuario.id);
  });
}

module.exports = {
  listarUsuarios,
  buscarUsuarioPorId,
  criarUsuario,
  atualizarUsuario,
  excluirUsuario
};

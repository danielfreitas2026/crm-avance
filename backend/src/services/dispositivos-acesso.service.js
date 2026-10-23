const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const Usuario = require('../models/Usuario');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const horario = require('./horario-acesso.service');
const auditoria = require('./audit-log.service');

const TABELA = 'acesso_dispositivos';
const CONFIG = 'configuracoes_acesso_rede';
const erro = (message, status = 400, code) => Object.assign(new Error(message), { status, code, acessoRedeSeguro: true });

function cookieConfig(req) {
  const local = ['development', 'test'].includes(process.env.NODE_ENV) &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(req.hostname) &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  return { nome: local ? 'crm_dispositivo' : '__Host-crm_dispositivo',
    opcoes: { httpOnly: true, secure: !local, sameSite: 'lax', path: '/', maxAge: 400 * 86400000 } };
}

function lerCredencial(req) {
  const { nome } = cookieConfig(req);
  const valores = (req.headers?.cookie || '').split(';').map(item => item.trim())
    .filter(item => item.startsWith(`${nome}=`)).map(item => item.slice(nome.length + 1));
  return valores.length === 1 && /^[a-f0-9]{64}$/.test(valores[0]) ? valores[0] : null;
}

async function buscarAtual(req, trx = db) {
  const credencial = lerCredencial(req);
  if (!credencial) return null;
  return trx(TABELA).where({ credencial_hash: crypto.createHash('sha256').update(credencial).digest('hex'), revogado_em: null }).first();
}

function definirCookie(req, res, credencial) {
  const { nome, opcoes } = cookieConfig(req);
  res.cookie(nome, credencial, opcoes);
}

async function renovarCookie(req, res) {
  if (await buscarAtual(req)) definirCookie(req, res, lerCredencial(req));
}

function metadados(row) {
  return { id: row.id, nome: row.nome, criado_por: row.criado_por,
    cadastrado_em: row.cadastrado_em, revogado_em: row.revogado_em };
}

async function listar(req) {
  const atual = await buscarAtual(req);
  const rows = await db(TABELA).orderBy('cadastrado_em', 'desc');
  const usuarios = await Usuario.query().select('id', 'nome');
  const nomes = new Map(usuarios.map(usuario => [usuario.id, usuario.nome]));
  return { dispositivo_atual_id: atual?.id || null, dispositivos: rows.map(row => ({
    ...metadados(row), responsavel_nome: nomes.get(row.criado_por) || null
  })) };
}

// Mesma ordem do controle de rede: configuração, usuário e então dispositivo.
async function bloquearGestor(req, trx) {
  await trx(CONFIG).where({ id: 1 }).forUpdate().first();
  const usuario = await Usuario.query(trx).findById(req.usuario.id).forUpdate().withGraphFetched('role');
  if (!usuario?.ativo || !(req.usuario.exp > Date.now() / 1000) ||
      (usuario.versao_sessao || 0) !== (req.usuario.versao_sessao || 0)) {
    throw erro('Sessão encerrada. Faça login novamente.', 401);
  }
  if (!usuarioTemPermissaoLocal(usuario, 'configurar_acesso_rede')) {
    throw erro('Você não tem permissão para executar esta ação.', 403);
  }
  const acesso = await horario.avaliarAcesso(usuario.id);
  if (!acesso.permitido) throw erro(acesso.motivo === 'SYSTEM_CLOSED' ? horario.SYSTEM_CLOSED_MESSAGE : 'Usuário inativo.',
    acesso.motivo === 'SYSTEM_CLOSED' ? 423 : 401, acesso.motivo === 'SYSTEM_CLOSED' ? 'SYSTEM_CLOSED' : undefined);
  return usuario;
}

async function autorizar(dados, req) {
  if (typeof dados?.nome !== 'string' || !dados.nome.trim() || dados.nome.trim().length > 80 ||
      typeof dados.senha_atual !== 'string' || !dados.senha_atual || dados.senha_atual.length > 1024) {
    throw erro('Informe um nome de até 80 caracteres e sua senha atual.');
  }
  return db.transaction(async trx => {
    const usuario = await bloquearGestor(req, trx);
    if (!await bcrypt.compare(dados.senha_atual, usuario.senha)) throw erro('Senha atual incorreta.');
    let row = await buscarAtual(req, trx);
    let credencial = lerCredencial(req);
    if (!row) {
      credencial = crypto.randomBytes(32).toString('hex');
      row = { id: crypto.randomUUID(), nome: dados.nome.trim(),
        credencial_hash: crypto.createHash('sha256').update(credencial).digest('hex'),
        criado_por: usuario.id, cadastrado_em: new Date(), revogado_em: null };
      await trx(TABELA).insert(row);
      await auditoria.registrar(req, { acao: 'config.dispositivo_autorizado', entidade: TABELA,
        entidade_id: row.id, dados: { nome: row.nome } }, trx);
    } else {
      await trx(TABELA).where({ id: row.id }).update({ nome: dados.nome.trim() });
      row.nome = dados.nome.trim();
    }
    return { dispositivo: metadados(row), credencial };
  });
}

async function revogar(id, req) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw erro('Dispositivo inválido.');
  return db.transaction(async trx => {
    await bloquearGestor(req, trx);
    const atual = await buscarAtual(req, trx);
    const row = await trx(TABELA).where({ id }).forUpdate().first();
    if (!row) throw erro('Dispositivo não encontrado.', 404);
    if (!row.revogado_em) {
      await trx(TABELA).where({ id }).update({ revogado_em: new Date() });
      await auditoria.registrar(req, { acao: 'config.dispositivo_revogado', entidade: TABELA,
        entidade_id: id, dados: { nome: row.nome } }, trx);
    }
    return { atual: atual?.id === id };
  });
}

function limparCookie(req, res) {
  const { nome, opcoes } = cookieConfig(req);
  const { maxAge: _maxAge, ...opcoesLimpeza } = opcoes;
  res.clearCookie(nome, opcoesLimpeza);
}

module.exports = { buscarAtual, listar, autorizar, revogar, definirCookie, limparCookie, renovarCookie };

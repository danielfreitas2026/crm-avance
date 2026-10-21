const crypto = require('node:crypto');
const { isIP } = require('node:net');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const Usuario = require('../models/Usuario');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const { normalizarIp, pertenceRede, validarRedes } = require('../utils/rede');
const horario = require('./horario-acesso.service');
const telegram = require('./telegram.service');
const auditoria = require('./audit-log.service');

const MINUTO = 60000;
const TABELA = 'acesso_rede_solicitacoes';
const CONFIG = 'configuracoes_acesso_rede';
const NETWORK_MESSAGE = 'Acesso fora da rede da empresa. Solicite o código ao administrador.';
const erro = (message, status = 400, code) => Object.assign(new Error(message), { status, code, acessoRedeSeguro: true });
const tempo = valor => typeof valor === 'string' && /^\d{4}-\d\d-\d\d /.test(valor)
  ? Date.parse(`${valor.replace(' ', 'T')}Z`) : new Date(valor).getTime();

function dispensado(usuario) {
  return Boolean(usuario?.ativo && (usuario.role?.nome === 'admin' || usuarioTemPermissaoLocal(usuario, 'acesso_rede_sem_codigo')));
}

function identificarSessao(decoded, token) {
  return decoded.jti || crypto.createHash('sha256').update(token).digest('hex');
}

function assinatura(id, codigo) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`acesso-rede:${id}:${codigo}`).digest('hex');
}

function telegramConfigurado() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_ACESSO_REDE_CHAT_ID?.trim());
}

function estadoConfiguracao(row) {
  if (!row) throw erro('Configuração de acesso por rede indisponível.', 503);
  return { ativo: Boolean(row.ativo), redes: validarRedes(JSON.parse(row.redes)) };
}

async function buscarConfiguracao(req) {
  const config = estadoConfiguracao(await db(CONFIG).where({ id: 1 }).first());
  return { ...config, ip_detectado: normalizarIp(req.ip),
    proxy_configurado: Boolean(String(process.env.TRUSTED_PROXY_CIDRS || '').trim()),
    telegram_configurado: telegramConfigurado() };
}

async function atualizarConfiguracao(dados, req) {
  if (typeof dados?.ativo !== 'boolean') throw erro('Informe se o bloqueio está ativo.');
  let redes;
  try { redes = validarRedes(dados.redes); } catch (e) { throw erro(e.message); }
  if (dados.ativo && (!redes.length || !telegramConfigurado())) {
    throw erro('Para ativar, cadastre uma rede e configure o bot e a conversa exclusiva do Telegram.');
  }
  await db.transaction(async trx => {
    const anterior = estadoConfiguracao(await trx(CONFIG).where({ id: 1 }).forUpdate().first());
    if (dados.ativo) {
      const usuarios = await Usuario.query(trx).where('ativo', true).withGraphFetched('role');
      if (!usuarios.some(usuario => dispensado(usuario) && usuarioTemPermissaoLocal(usuario, 'configurar_acesso_rede'))) {
        throw erro('Mantenha um usuário ativo dispensado do código com permissão para configurar o acesso por rede.');
      }
    }
    await trx(CONFIG).where({ id: 1 }).update({ ativo: dados.ativo, redes: JSON.stringify(redes), updated_at: new Date() });
    await trx(TABELA).whereIn('estado', ['pendente', 'aprovado']).update({ estado: 'revogado' });
    await auditoria.registrar(req, { acao: 'config.acesso_rede_atualizado', entidade: CONFIG, entidade_id: 1,
      dados: { anterior, novo: { ativo: dados.ativo, redes } } }, trx);
  });
  return buscarConfiguracao(req);
}

function respostaPendente(row) {
  return { code: 'NETWORK_ACCESS_REQUIRED', message: NETWORK_MESSAGE,
    solicitacao_id: row.id, expira_em: new Date(tempo(row.expira_em)).toISOString() };
}

// A configuração é bloqueada primeiro, depois o usuário. Todas as instâncias
// compartilham deduplicação, cotas, consumo e revogação pelo mesmo banco.
async function avaliar(usuario, req, sessao) {
  const config = estadoConfiguracao(await db(CONFIG).where({ id: 1 }).first());
  if (!config.ativo || dispensado(usuario)) return;
  const ip = normalizarIp(req.ip);
  if (!isIP(ip)) throw erro('Não foi possível identificar a rede de acesso.', 403);
  if (pertenceRede(ip, config.redes)) return;
  const resultado = await db.transaction(async trx => {
    const atual = estadoConfiguracao(await trx(CONFIG).where({ id: 1 }).forUpdate().first());
    const pessoa = await Usuario.query(trx).findById(usuario.id).forUpdate().withGraphFetched('role');
    if (!pessoa?.ativo || (pessoa.versao_sessao || 0) !== (usuario.versao_sessao || 0)) throw erro('Sessão encerrada. Faça login novamente.', 401);
    if (!atual.ativo || dispensado(pessoa) || pertenceRede(ip, atual.redes)) return;
    const agora = new Date();
    if (sessao) {
      const aprovada = await trx(TABELA).where({ usuario_id: usuario.id, sessao_id: sessao.id, ip, estado: 'aprovado',
        versao_sessao: pessoa.versao_sessao || 0 }).where('sessao_expira_em', '>', agora).first();
      if (aprovada) return;
    }
    const registros = await trx(TABELA).where({ usuario_id: usuario.id })
      .where('created_at', '>', new Date(agora.getTime() - 60 * MINUTO)).orderBy('created_at', 'desc');
    const pendente = registros.find(row => row.estado === 'pendente' && row.ip === ip &&
      row.versao_sessao === (pessoa.versao_sessao || 0) && tempo(row.expira_em) > agora.getTime() &&
      (sessao ? row.sessao_id === sessao.id : row.origem === 'login'));
    if (pendente) return respostaPendente(pendente);
    if (registros.length >= 5 || registros.some(row => tempo(row.created_at) > agora.getTime() - MINUTO)) {
      throw erro('Limite de solicitações atingido. Aguarde antes de tentar novamente.', 429);
    }
    const porIp = await trx(TABELA).where({ ip }).where('created_at', '>', new Date(agora.getTime() - MINUTO)).count('* as total').first();
    if (Number(porIp.total) >= 20) throw erro('Muitas solicitações nesta rede. Aguarde um minuto.', 429);
    if (!telegramConfigurado()) throw erro('Não foi possível enviar o código. Contate o administrador.', 503);
    const id = crypto.randomUUID();
    const codigo = Array.from({ length: 6 }, () => String.fromCharCode(65 + crypto.randomInt(26))).join('');
    const row = { id, usuario_id: pessoa.id, sessao_id: sessao?.id || crypto.randomUUID(),
      versao_sessao: pessoa.versao_sessao || 0, ip, origem: sessao ? 'sessao' : 'login',
      codigo_hash: assinatura(id, codigo), estado: 'pendente', tentativas: 0,
      created_at: agora, expira_em: new Date(agora.getTime() + 10 * MINUTO),
      sessao_expira_em: sessao ? new Date(sessao.exp * 1000) : null };
    await trx(TABELA).insert(row);
    try {
      await telegram.enviarCodigoAcessoRede({ usuario: pessoa, ip, codigo, id, agora });
    } catch {
      await trx(TABELA).where({ id }).update({ estado: 'falha' });
      return { falha: true };
    }
    await auditoria.registrar(req, { usuario_id: pessoa.id, acao: 'auth.acesso_rede_solicitado', entidade: TABELA,
      entidade_id: id, dados: { ip } }, trx);
    return respostaPendente(row);
  });
  if (resultado?.falha) throw erro('Não foi possível enviar o código. Aguarde um minuto e tente novamente.', 503);
  if (resultado) throw Object.assign(erro(NETWORK_MESSAGE, 403, 'NETWORK_ACCESS_REQUIRED'), { detalhes: resultado });
}

async function avaliarSessao(req, decoded, token) {
  // Carregar o perfil atual evita que a dispensa fique presa às claims do JWT.
  const config = estadoConfiguracao(await db(CONFIG).where({ id: 1 }).first());
  if (!config.ativo) return;
  const usuario = await Usuario.query().findById(decoded.id).withGraphFetched('role');
  if (!usuario?.ativo) throw erro('Usuário inativo.', 401);
  if ((decoded.versao_sessao || 0) !== (usuario.versao_sessao || 0)) throw erro('Sessão encerrada. Faça login novamente.', 401);
  return avaliar(usuario, req, { id: identificarSessao(decoded, token), exp: decoded.exp });
}

async function validar(dados, req) {
  if (typeof dados?.solicitacao_id !== 'string' || !/^[a-f0-9-]{36}$/.test(dados.solicitacao_id) || typeof dados.codigo !== 'string') {
    throw erro('Solicitação ou código inválido.');
  }
  const referencia = await db(TABELA).where({ id: dados.solicitacao_id }).first();
  if (!referencia) throw erro('Solicitação inválida ou expirada.');
  const resultado = await db.transaction(async trx => {
    const config = estadoConfiguracao(await trx(CONFIG).where({ id: 1 }).forUpdate().first());
    const usuario = await Usuario.query(trx).findById(referencia.usuario_id).forUpdate().withGraphFetched('role');
    const row = await trx(TABELA).where({ id: referencia.id }).forUpdate().first();
    const agora = Date.now();
    if (!config.ativo || !usuario?.ativo || row.estado !== 'pendente' || !(tempo(row.expira_em) > agora) ||
        row.ip !== normalizarIp(req.ip) || row.versao_sessao !== (usuario.versao_sessao || 0) ||
        (row.sessao_expira_em && !(tempo(row.sessao_expira_em) > agora))) throw erro('Solicitação inválida ou expirada. Faça login novamente.');
    const acesso = await horario.avaliarAcesso(usuario.id);
    if (!acesso.permitido) throw erro(acesso.motivo === 'SYSTEM_CLOSED' ? horario.SYSTEM_CLOSED_MESSAGE : 'Usuário inativo.',
      acesso.motivo === 'SYSTEM_CLOSED' ? 423 : 401, acesso.motivo === 'SYSTEM_CLOSED' ? 'SYSTEM_CLOSED' : undefined);
    const codigo = dados.codigo.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(codigo) || !crypto.timingSafeEqual(Buffer.from(row.codigo_hash, 'hex'), Buffer.from(assinatura(row.id, codigo), 'hex'))) {
      const tentativas = row.tentativas + 1;
      await trx(TABELA).where({ id: row.id }).update({ tentativas, estado: tentativas >= 5 ? 'bloqueado' : 'pendente' });
      await auditoria.registrar(req, { usuario_id: usuario.id, acao: 'auth.acesso_rede_codigo_falha', entidade: TABELA,
        entidade_id: row.id, dados: { tentativas } }, trx);
      return { falha: tentativas >= 5 ? 'Limite de tentativas atingido. Faça login novamente.' : 'Código incorreto.' };
    }
    const auth = require('./auth.service');
    const sessao = await auth.criarSessao(usuario, { sessaoId: row.sessao_id,
      expiraEm: row.sessao_expira_em ? Math.floor(tempo(row.sessao_expira_em) / 1000) : undefined });
    const decoded = jwt.decode(sessao.token);
    await trx(TABELA).where({ usuario_id: usuario.id, sessao_id: row.sessao_id, estado: 'aprovado' })
      .update({ estado: 'revogado' });
    await trx(TABELA).where({ id: row.id }).update({ estado: 'aprovado', sessao_expira_em: new Date(decoded.exp * 1000) });
    await auditoria.registrar(req, { usuario_id: usuario.id, acao: 'auth.acesso_rede_liberado', entidade: TABELA,
      entidade_id: row.id, dados: { ip: row.ip } }, trx);
    return sessao;
  });
  if (resultado.falha) throw erro(resultado.falha);
  return resultado;
}

async function logout(req) {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { throw erro('Token inválido ou expirado.', 401); }
  await db.transaction(async trx => {
    await trx(CONFIG).where({ id: 1 }).forUpdate().first();
    await Usuario.query(trx).findById(decoded.id).forUpdate();
    await trx(TABELA).where({ usuario_id: decoded.id, sessao_id: identificarSessao(decoded, token) })
      .whereIn('estado', ['pendente', 'aprovado']).update({ estado: 'revogado' });
  });
  return { message: 'Sessão encerrada.' };
}

module.exports = { dispensado, identificarSessao, buscarConfiguracao, atualizarConfiguracao, avaliar,
  avaliarSessao, validar, logout };

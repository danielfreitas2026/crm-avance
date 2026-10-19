const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const Usuario = require('../models/Usuario');
const Token = require('../models/RecuperacaoContaToken');
const emailService = require('./recuperacao-conta-email.service');
const { prepararSenha } = require('../utils/senha-usuario');
const auditoria = require('./audit-log.service');

const MENSAGEM_SOLICITACAO = 'Se a conta estiver ativa e possuir um e-mail de recuperação confirmado, enviaremos as instruções.';
const HORA = 60 * 60 * 1000;

function erro(message, status = 400) {
  return Object.assign(new Error(message), { status, recuperacaoSegura: true });
}

function normalizarEmail(email) {
  if (typeof email !== 'string') throw erro('Informe um e-mail válido.');
  const valor = email.trim().toLowerCase();
  if (valor.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
    throw erro('Informe um e-mail válido.');
  }
  return valor;
}

function dadosPerfil(usuario) {
  return {
    email_recuperacao: usuario.email_recuperacao || null,
    email_recuperacao_pendente: usuario.email_recuperacao_pendente || null,
    email_recuperacao_confirmado_em: usuario.email_recuperacao_confirmado_em || null
  };
}

function expiracaoEmMilissegundos(valor) {
  // O driver MySQL usa dateStrings e timezone +00:00. Não interpretar seu
  // timestamp SQL como horário local do processo (que pode ser São Paulo).
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(valor)) {
    return Date.parse(`${valor.replace(' ', 'T')}Z`);
  }
  return new Date(valor).getTime();
}

async function validarSenhaAtual(usuario, senha) {
  if (!usuario.ativo || typeof senha !== 'string' || !senha ||
      !await bcrypt.compare(senha, usuario.senha)) {
    throw erro('Senha atual incorreta.');
  }
}

async function invalidarTokens(trx, usuarioId, finalidade) {
  const query = Token.query(trx).where('usuario_id', usuarioId).whereNull('usado_em');
  if (finalidade) query.where('finalidade', finalidade);
  await query.patch({ usado_em: new Date() });
}

// O chamador mantém a linha do usuário bloqueada durante emissão e envio.
// Uma falha de envio desfaz a transação e não consome a cota de envios.
async function emitir(trx, usuario, destinatario, finalidade) {
  const agora = new Date();
  const contagem = await Token.query(trx).where({ usuario_id: usuario.id, finalidade })
    .where('created_at', '>', new Date(agora.getTime() - HORA)).resultSize();
  if (contagem >= 2) throw erro('Limite de dois envios por hora atingido. Tente novamente mais tarde.', 429);
  if (finalidade === 'confirmacao') await invalidarTokens(trx, usuario.id, finalidade);
  const token = crypto.randomBytes(32).toString('hex');
  await Token.query(trx).insert({
    usuario_id: usuario.id, finalidade, destinatario,
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    expira_em: new Date(agora.getTime() + (finalidade === 'confirmacao' ? 24 : 1) * HORA),
    created_at: agora
  });
  try {
    await emailService.enviar({ destinatario, token, finalidade });
  } catch {
    console.error('Falha no envio de e-mail de recuperação de conta.');
    throw erro('Não foi possível enviar o e-mail. Tente novamente mais tarde.', 503);
  }
}

async function configurarEmail(trx, usuario, email, senhaAtual) {
  await validarSenhaAtual(usuario, senhaAtual);
  if (email === null || email === '') {
    await invalidarTokens(trx, usuario.id);
    return { email_recuperacao: null, email_recuperacao_pendente: null, email_recuperacao_confirmado_em: null };
  }
  const destinatario = normalizarEmail(email);
  if (destinatario === usuario.email_recuperacao && !usuario.email_recuperacao_pendente) return {};
  // Selecionar novamente o endereço confirmado cancela uma substituição pendente.
  if (destinatario === usuario.email_recuperacao) {
    await invalidarTokens(trx, usuario.id, 'confirmacao');
    return { email_recuperacao_pendente: null };
  }
  await emitir(trx, usuario, destinatario, 'confirmacao');
  return { email_recuperacao_pendente: destinatario };
}

async function reenviarConfirmacao(usuarioId, senhaAtual) {
  await Usuario.transaction(async trx => {
    const usuario = await Usuario.query(trx).findById(usuarioId).forUpdate();
    if (!usuario) throw erro('Usuário não encontrado.', 404);
    await validarSenhaAtual(usuario, senhaAtual);
    if (!usuario.email_recuperacao_pendente) throw erro('Não há e-mail aguardando confirmação.');
    await emitir(trx, usuario, usuario.email_recuperacao_pendente, 'confirmacao');
  });
}

async function solicitar(email, req) {
  const identificador = normalizarEmail(email);
  try {
    await Usuario.transaction(async trx => {
      const usuario = await Usuario.query(trx).where('email', identificador).first().forUpdate();
      if (!usuario?.ativo || !usuario.email_recuperacao || !usuario.email_recuperacao_confirmado_em) return;
      await emitir(trx, usuario, usuario.email_recuperacao, 'redefinicao');
      await auditoria.registrar(req, {
        usuario_id: usuario.id, acao: 'auth.recuperacao_solicitada', entidade: 'usuarios', entidade_id: usuario.id
      }, trx);
    });
  } catch {
    // Mesma resposta para conta ausente, cota excedida, SMTP ou persistência indisponível.
    console.error('Solicitação de recuperação de conta não enviada.');
  }
  return { message: MENSAGEM_SOLICITACAO };
}

async function consumir(token, finalidade, alterar, req) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw erro('Link inválido ou expirado.');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const referencia = await Token.query().findOne({ token_hash: tokenHash, finalidade });
  if (!referencia) throw erro('Link inválido ou expirado.');
  return Usuario.transaction(async trx => {
    // Todos os fluxos bloqueiam primeiro o usuário, depois seus tokens.
    const usuario = await Usuario.query(trx).findById(referencia.usuario_id).forUpdate();
    const registro = await Token.query(trx).findById(referencia.id).forUpdate();
    const expiracao = registro ? expiracaoEmMilissegundos(registro.expira_em) : NaN;
    if (!usuario?.ativo || !registro || registro.usado_em ||
        !Number.isFinite(expiracao) || expiracao <= Date.now() ||
        registro.destinatario !== (finalidade === 'confirmacao' ? usuario.email_recuperacao_pendente : usuario.email_recuperacao) ||
        (finalidade === 'redefinicao' && !usuario.email_recuperacao_confirmado_em)) {
      throw erro('Link inválido ou expirado.');
    }
    const alteracoes = await alterar(usuario);
    await Usuario.query(trx).patchAndFetchById(usuario.id, alteracoes);
    await invalidarTokens(trx, usuario.id);
    await auditoria.registrar(req, {
      usuario_id: usuario.id,
      acao: finalidade === 'confirmacao' ? 'auth.email_recuperacao_confirmado' : 'auth.senha_redefinida',
      entidade: 'usuarios', entidade_id: usuario.id
    }, trx);
  });
}

async function confirmarEmail(token, req) {
  await consumir(token, 'confirmacao', usuario => ({
    email_recuperacao: usuario.email_recuperacao_pendente,
    email_recuperacao_pendente: null,
    email_recuperacao_confirmado_em: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }), req);
  return { message: 'E-mail de recuperação confirmado com sucesso.' };
}

async function redefinirSenha(token, senha, req) {
  if (typeof senha !== 'string' || senha.length < 8 || !/\d/.test(senha) || Buffer.byteLength(senha, 'utf8') > 72) {
    throw erro('A senha deve ter pelo menos 8 caracteres, um número e no máximo 72 bytes.');
  }
  await consumir(token, 'redefinicao', async usuario => ({
    ...await prepararSenha(senha), versao_sessao: (usuario.versao_sessao || 0) + 1
  }), req);
  return { message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
}

module.exports = { dadosPerfil, configurarEmail, reenviarConfirmacao, solicitar, confirmarEmail, redefinirSenha, invalidarTokens };

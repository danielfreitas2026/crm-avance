/**
 * Servico de envio de notificacoes por e-mail e verificacao de configuracao SMTP.
 */
const { emailUser, emailHost, emailPort, emailSecure, emailConfigurado, getTransporter } = require('./email-transporte.service');
const Notificacao = require('../models/Notificacao');
const NotificacaoDestinatario = require('../models/NotificacaoDestinatario');
const Usuario = require('../models/Usuario');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERMISSAO_RECEBER_EMAIL = 'notificacoes_receber_email';

/**
 * Retorna status configuracao no formato esperado pelo fluxo.
 */
function statusConfiguracao() {
  return {
    configurado: emailConfigurado(),
    host: emailHost(),
    port: emailPort(),
    secure: emailSecure(),
    user: emailUser() || null,
    frontend_url: frontendUrl()
  };
}

/**
 * Converte dados para o formato interno esperado.
 */
function parseDados(dados) {
  if (!dados) return {};
  if (typeof dados === 'string') {
    try {
      return JSON.parse(dados);
    } catch {
      return {};
    }
  }

  return dados;
}

/**
 * Verifica se usuario pode receber email atende a condicao esperada.
 */
function usuarioPodeReceberEmail(usuario) {
  if (!usuario?.ativo) return false;
  return usuarioTemPermissaoLocal(usuario, PERMISSAO_RECEBER_EMAIL);
}

/**
 * Escapa escape html para evitar quebra de formato.
 */
function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Retorna frontend url no formato esperado pelo fluxo.
 */
function frontendUrl() {
  return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/**
 * Retorna absolute url no formato esperado pelo fluxo.
 */
function absoluteUrl(path) {
  if (!path) return frontendUrl();
  if (/^https?:\/\//i.test(path)) return path;
  return `${frontendUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Retorna detalhes from entries no formato esperado pelo fluxo.
 */
function detalhesFromEntries(entries) {
  return entries
    .filter(([, valor]) => valor !== null && valor !== undefined && String(valor).trim() !== '')
    .map(([label, valor]) => ({ label, value: valor }));
}

/**
 * Monta acao a partir dos dados informados.
 */
function montarAcao(notificacao) {
  const dados = parseDados(notificacao.dados);
  const vendaId = notificacao.entidade_id || dados.venda_id;
  const clienteId = notificacao.entidade_id || dados.cliente_id || dados.entidade_id;

  switch (notificacao.tipo) {
    case 'venda_aprovacao_pendente':
      return {
        label: 'Abrir solicitacao',
        path: dados.solicitacao_id
          ? `/vendas/aprovacoes?solicitacao_id=${encodeURIComponent(dados.solicitacao_id)}&status=pendente`
          : '/vendas/aprovacoes?status=pendente',
        detalhes: detalhesFromEntries([
          ['Venda', dados.venda_nome],
          ['Motivo', Array.isArray(dados.motivos) ? dados.motivos.join(', ') : dados.motivos]
        ])
      };
    case 'venda_retorno_registrado':
      return {
        label: 'Corrigir retorno',
        path: vendaId ? `/retornos?venda_id=${encodeURIComponent(vendaId)}` : '/retornos',
        detalhes: detalhesFromEntries([
          ['Venda', dados.venda_nome],
          ['Motivo do retorno', dados.motivo_retorno],
          ['Status anterior', dados.status_anterior]
        ])
      };
    case 'venda_problema_aberto':
    case 'venda_problema_resolvido':
    case 'venda_problema_correcao':
      return {
        label: 'Abrir problema',
        path: vendaId
          ? `/vendas?venda_id=${encodeURIComponent(vendaId)}&aba=problema${dados.problema_id ? `&problema_id=${encodeURIComponent(dados.problema_id)}` : ''}`
          : '/vendas',
        detalhes: detalhesFromEntries([
          ['Venda', dados.venda_nome],
          ['Mensagem', dados.mensagem]
        ])
      };
    case 'nota_retorno_pre':
    case 'nota_retorno_due': {
      const isCliente = dados.entidade_tipo === 'cliente' || notificacao.entidade === 'clientes';
      const isLead = dados.entidade_tipo === 'lead' || notificacao.entidade === 'clientes-secretos';
      const id = dados.entidade_id || notificacao.entidade_id;
      return {
        label: 'Abrir retorno',
        path: isLead
          ? '/clientes-secretos'
          : isCliente
            ? (id ? `/clientes?cliente_id=${encodeURIComponent(id)}&highlight=${encodeURIComponent(id)}` : '/clientes')
            : (id ? `/vendas?venda_id=${encodeURIComponent(id)}&aba=notas` : '/vendas'),
        detalhes: detalhesFromEntries([
          ['Titulo', dados.titulo_nota],
          ['Retorno agendado', dados.retorno_agendado_para]
        ])
      };
    }
    case 'cliente_fidelidade':
      return {
        label: 'Ver cliente',
        path: clienteId
          ? `/clientes?cliente_id=${encodeURIComponent(clienteId)}&highlight=${encodeURIComponent(clienteId)}`
          : `/clientes?fidelidade=${Number(dados.dias_restantes ?? 1) < 0 ? 'vencida' : 'alerta'}`,
        detalhes: detalhesFromEntries([
          ['Cliente', dados.cliente_nome],
          ['Operadora', dados.operadora_nome],
          ['Fim da fidelidade', dados.fidelidade_fim]
        ])
      };
    case 'venda_parada_funil':
      return {
        label: 'Abrir venda',
        path: vendaId ? `/vendas?venda_id=${encodeURIComponent(vendaId)}` : '/vendas',
        detalhes: detalhesFromEntries([
          ['Venda', dados.venda_nome],
          ['Etapa', dados.etapa_nome],
          ['Tempo parado', dados.horas ? `${dados.horas} horas` : null]
        ])
      };
    default:
      if (notificacao.entidade === 'clientes') {
        return {
          label: 'Abrir cliente',
          path: clienteId ? `/clientes?cliente_id=${encodeURIComponent(clienteId)}&highlight=${encodeURIComponent(clienteId)}` : '/clientes',
          detalhes: []
        };
      }

      return {
        label: 'Abrir no sistema',
        path: vendaId ? `/vendas?venda_id=${encodeURIComponent(vendaId)}` : '/',
        detalhes: []
      };
  }
}

/**
 * Monta html a partir dos dados informados.
 */
function montarHtml({ notificacao, usuario, actionUrl, actionLabel, detalhes }) {
  const detalhesHtml = detalhes.length > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse;">${detalhes.map(item => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${escapeHtml(item.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;text-align:right;font-weight:600;">${escapeHtml(item.value)}</td>
        </tr>`).join('')}
      </table>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(notificacao.titulo)}</title>
  </head>
  <body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(notificacao.mensagem)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px;background:#111827;color:#ffffff;">
                <div style="font-size:13px;opacity:.78;">Pos-venda Avance VIP</div>
                <div style="font-size:22px;font-weight:700;line-height:1.25;margin-top:6px;">${escapeHtml(notificacao.titulo)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Ola, ${escapeHtml(usuario.nome || 'tudo bem')}.</p>
                <p style="margin:0;color:#374151;font-size:15px;line-height:1.55;">${escapeHtml(notificacao.mensagem)}</p>
                ${detalhesHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
                  <tr>
                    <td style="border-radius:6px;background:#2563eb;">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">${escapeHtml(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">Se o botao nao abrir, acesse este link:<br><a href="${escapeHtml(actionUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(actionUrl)}</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Monta texto a partir dos dados informados.
 */
function montarTexto({ notificacao, usuario, actionUrl, actionLabel, detalhes }) {
  const linhas = [
    `Ola, ${usuario.nome || 'tudo bem'}.`,
    '',
    notificacao.titulo,
    notificacao.mensagem,
    ''
  ];

  detalhes.forEach(item => linhas.push(`${item.label}: ${item.value}`));
  if (detalhes.length > 0) linhas.push('');
  linhas.push(`${actionLabel}: ${actionUrl}`);

  return linhas.join('\n');
}

/**
 * Envia email destinatario para processamento.
 */
async function enviarEmailDestinatario({ notificacao, destinatario, usuario }) {
  if (!usuarioPodeReceberEmail(usuario)) {
    await NotificacaoDestinatario.query()
      .patch({ email_erro: 'Usuario sem permissao para receber notificacoes por email.' })
      .where('id', destinatario.id);
    return false;
  }

  if (!EMAIL_RE.test(String(usuario.email || '').trim())) {
    await NotificacaoDestinatario.query()
      .patch({ email_erro: 'Email invalido.' })
      .where('id', destinatario.id);
    return false;
  }

  const mailer = getTransporter();
  if (!mailer) return false;

  const acao = montarAcao(notificacao);
  const actionUrl = absoluteUrl(acao.path);
  const payload = {
    notificacao,
    usuario,
    actionUrl,
    actionLabel: acao.label,
    detalhes: acao.detalhes || []
  };

  await mailer.sendMail({
    from: `"Pos-venda Avance VIP" <${emailUser()}>`,
    to: usuario.email,
    subject: `[Pos-venda] ${notificacao.titulo}`,
    html: montarHtml(payload),
    text: montarTexto(payload)
  });

  await NotificacaoDestinatario.query()
    .patch({
      email_enviado_em: new Date(),
      email_erro: null
    })
    .where('id', destinatario.id);

  return true;
}

/**
 * Envia email teste para processamento.
 */
async function enviarEmailTeste(usuario) {
  if (!emailConfigurado()) {
    const error = new Error('SMTP nao configurado. Defina SMTP_USER/SMTP_PASS ou EMAIL/EMAIL_PASSWORD.');
    error.statusCode = 400;
    throw error;
  }

  if (!usuario?.ativo || !EMAIL_RE.test(String(usuario.email || '').trim())) {
    const error = new Error('Usuario logado nao possui email valido para receber o teste.');
    error.statusCode = 400;
    throw error;
  }

  const mailer = getTransporter();
  const actionUrl = absoluteUrl('/');
  const notificacao = {
    titulo: 'Teste de email do Pos-venda',
    mensagem: 'Se voce recebeu este email, a conexao SMTP do sistema esta funcionando.'
  };
  const payload = {
    notificacao,
    usuario,
    actionUrl,
    actionLabel: 'Abrir sistema',
    detalhes: detalhesFromEntries([
      ['SMTP', `${emailHost()}:${emailPort()}`],
      ['Remetente', emailUser()]
    ])
  };

  const info = await mailer.sendMail({
    from: `"Pos-venda Avance VIP" <${emailUser()}>`,
    to: usuario.email,
    subject: '[Pos-venda] Teste de email',
    html: montarHtml(payload),
    text: montarTexto(payload)
  });

  return {
    enviado: true,
    to: usuario.email,
    message_id: info.messageId || null,
    accepted: info.accepted || [],
    rejected: info.rejected || []
  };
}

/**
 * Envia emails pendentes para processamento.
 */
async function enviarEmailsPendentes(notificacaoId) {
  if (!emailConfigurado()) return { enviados: 0, ignorado: true };

  const notificacao = await Notificacao.query().findById(notificacaoId);
  if (!notificacao?.ativa) return { enviados: 0 };

  const destinatarios = await NotificacaoDestinatario.query()
    .where('notificacao_id', notificacaoId)
    .whereNull('email_enviado_em')
    .whereNull('email_erro');

  let enviados = 0;

  for (const destinatario of destinatarios) {
    try {
      const usuario = await Usuario.query()
        .findById(destinatario.usuario_id)
        .withGraphFetched('role');
      const enviado = await enviarEmailDestinatario({ notificacao, destinatario, usuario });
      if (enviado) enviados += 1;
    } catch (error) {
      const mensagem = String(error.message || 'Erro ao enviar email.').slice(0, 1000);
      console.error('Erro ao enviar email de notificacao:', {
        notificacao_id: notificacaoId,
        destinatario_id: destinatario.id,
        usuario_id: destinatario.usuario_id,
        error: mensagem
      });

      await NotificacaoDestinatario.query()
        .patch({ email_erro: mensagem })
        .where('id', destinatario.id);
    }
  }

  return { enviados };
}

/**
 * Envia emails pendentes async para processamento.
 */
function enviarEmailsPendentesAsync(notificacaoId) {
  setTimeout(() => {
    enviarEmailsPendentes(notificacaoId).catch(error => {
      console.error('Erro ao processar emails de notificacao:', {
        notificacao_id: notificacaoId,
        error: error.message
      });
    });
  }, 500);
}

module.exports = {
  enviarEmailsPendentes,
  enviarEmailsPendentesAsync,
  enviarEmailTeste,
  statusConfiguracao,
  PERMISSAO_RECEBER_EMAIL,
  _internals: {
    montarAcao,
    montarHtml,
    montarTexto,
    absoluteUrl
  }
};

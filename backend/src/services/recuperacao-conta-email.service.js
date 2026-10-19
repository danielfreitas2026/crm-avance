const transporte = require('./email-transporte.service');

async function enviar({ destinatario, token, finalidade }) {
  const mailer = transporte.getTransporter();
  if (!mailer) throw new Error('SMTP indisponível.');
  const base = new URL(process.env.FRONTEND_URL || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) {
    throw new Error('URL do frontend inválida.');
  }
  const confirmacao = finalidade === 'confirmacao';
  const url = new URL(confirmacao ? '/confirmar-email-recuperacao' : '/redefinir-senha', base);
  url.hash = new URLSearchParams({ token }).toString();
  const titulo = confirmacao ? 'Confirme seu e-mail de recuperação' : 'Redefinição de senha';
  const prazo = confirmacao ? '24 horas' : '1 hora';
  const texto = `${titulo} no CRM Avance. Acesse: ${url.href}\nEste link é válido por ${prazo} e pode ser usado uma única vez.\nSe você não fez esta solicitação, ignore este e-mail.`;
  const info = await mailer.sendMail({
    from: `"CRM Avance" <${transporte.emailUser()}>`, to: destinatario,
    subject: `[CRM Avance] ${titulo}`, text: texto,
    html: `<h1>${titulo}</h1><p><a href="${url.href}">${titulo}</a></p><p>Este link é válido por ${prazo} e pode ser usado uma única vez.</p><p>Se você não fez esta solicitação, ignore este e-mail.</p>`
  });
  if (info.rejected?.length) throw new Error('Destinatário recusado.');
}

module.exports = { enviar };

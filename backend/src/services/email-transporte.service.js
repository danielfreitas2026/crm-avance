const nodemailer = require('nodemailer');

let transporter = null;
const emailUser = () => process.env.EMAIL || process.env.SMTP_USER || '';
const emailPassword = () => process.env.EMAIL_PASSWORD || process.env.SMTP_PASS || '';
const emailHost = () => process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com';
const emailPort = () => Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 465);
const emailSecure = () => String(process.env.EMAIL_SECURE || process.env.SMTP_SECURE || 'true') !== 'false';
const emailConfigurado = () => Boolean(emailUser() && emailPassword());

function getTransporter() {
  if (!emailConfigurado()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: emailHost(), port: emailPort(), secure: emailSecure(),
      auth: { user: emailUser(), pass: emailPassword() },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
  }
  return transporter;
}

module.exports = { emailUser, emailHost, emailPort, emailSecure, emailConfigurado, getTransporter };

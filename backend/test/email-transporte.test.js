const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const transporte = require('../src/services/email-transporte.service');
const notificacoes = require('../src/services/notificacao-email.service');
const recuperacao = require('../src/services/recuperacao-conta-email.service');

test('notificações e recuperação compartilham SMTP e preservam destinatários e aliases existentes', async t => {
  const valores = {
    SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'smtp@example.com', SMTP_PASS: 'senha-teste',
    EMAIL: 'alias@example.com', EMAIL_PASSWORD: 'senha-alias-teste',
    EMAIL_HOST: 'alias-smtp.example.com', EMAIL_PORT: '465', EMAIL_SECURE: 'true',
    FRONTEND_URL: 'https://crm.example.com'
  };
  for (const [nome, valor] of Object.entries(valores)) {
    const anterior = process.env[nome];
    process.env[nome] = valor;
    t.after(() => { if (anterior === undefined) delete process.env[nome]; else process.env[nome] = anterior; });
  }
  const mensagens = [];
  const criar = t.mock.method(nodemailer, 'createTransport', configuracao => {
    assert.equal(configuracao.host, 'alias-smtp.example.com');
    assert.equal(configuracao.port, 465);
    assert.equal(configuracao.secure, true);
    assert.deepEqual(configuracao.auth, { user: 'alias@example.com', pass: 'senha-alias-teste' });
    return { sendMail: async dados => { mensagens.push(dados); return { accepted: [dados.to], rejected: [] }; } };
  });
  assert.equal(transporte.emailConfigurado(), true);
  await notificacoes.enviarEmailTeste({ ativo: true, email: 'acesso@crm.local', nome: 'Ana' });
  await recuperacao.enviar({ destinatario: 'real@example.com', token: 'a'.repeat(64), finalidade: 'redefinicao' });
  assert.equal(criar.mock.callCount(), 1);
  assert.equal(mensagens[0].to, 'acesso@crm.local');
  assert.equal(mensagens[1].to, 'real@example.com');
  for (const nome of ['EMAIL', 'EMAIL_PASSWORD', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_SECURE']) delete process.env[nome];
  assert.equal(transporte.emailUser(), 'smtp@example.com');
  assert.equal(transporte.emailHost(), 'smtp.example.com');
  assert.equal(transporte.emailPort(), 587);
  assert.equal(transporte.emailSecure(), false);
});

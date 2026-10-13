const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { criptografarSenha, descriptografarSenha } = require('../src/utils/cofre-senhas');

let chaveAnterior;
beforeEach(() => {
  chaveAnterior = process.env.CRM_PASSWORD_VAULT_KEY;
  process.env.CRM_PASSWORD_VAULT_KEY = Buffer.alloc(32, 7).toString('base64');
});
afterEach(() => {
  if (chaveAnterior === undefined) delete process.env.CRM_PASSWORD_VAULT_KEY;
  else process.env.CRM_PASSWORD_VAULT_KEY = chaveAnterior;
});

test('cifra sem texto aberto, recupera unicode e usa um IV novo a cada gravação', () => {
  const senha = 'Senha çã 🚀\n teste';
  const a = criptografarSenha(senha, 'hash');
  const b = criptografarSenha(senha, 'hash');
  assert.notEqual(a, b);
  assert.ok(!a.includes(senha));
  assert.equal(descriptografarSenha(a, 'hash'), senha);
  assert.equal(Buffer.from(JSON.parse(a).iv, 'base64').length, 12);
  assert.equal(Buffer.from(JSON.parse(a).tag, 'base64').length, 16);
});

test('rejeita adulteração do conteúdo, IV, tag e hash correspondente', () => {
  const registro = criptografarSenha('senha-teste', 'hash');
  for (const campo of ['conteudo', 'iv', 'tag']) {
    const dados = JSON.parse(registro);
    const buffer = Buffer.from(dados[campo], 'base64');
    buffer[0] ^= 1;
    dados[campo] = buffer.toString('base64');
    assert.throws(() => descriptografarSenha(JSON.stringify(dados), 'hash'), { status: 503 });
  }
  assert.throws(() => descriptografarSenha(registro, 'outro-hash'), { status: 503 });
});

test('conteúdo vazio é autenticado sem aceitar chave, IV ou tag vazios', () => {
  const registro = criptografarSenha('', 'hash');
  assert.equal(descriptografarSenha(registro, 'hash'), '');
  for (const campo of ['iv', 'tag']) {
    assert.throws(() => descriptografarSenha(JSON.stringify({ ...JSON.parse(registro), [campo]: '' }), 'hash'), { status: 503 });
  }
});

test('falha de maneira genérica para chave incorreta, ausente ou inválida', () => {
  const registro = criptografarSenha('senha-teste', 'hash');
  for (const chave of [undefined, '', 'inválida', Buffer.alloc(16).toString('base64'), Buffer.alloc(32, 8).toString('base64')]) {
    if (chave === undefined) delete process.env.CRM_PASSWORD_VAULT_KEY;
    else process.env.CRM_PASSWORD_VAULT_KEY = chave;
    assert.throws(() => descriptografarSenha(registro, 'hash'), error => {
      assert.equal(error.status, 503);
      assert.equal(error.message, 'Gerenciador de senhas temporariamente indisponível.');
      return true;
    });
    if (chave !== Buffer.alloc(32, 8).toString('base64')) {
      assert.throws(() => criptografarSenha('senha-teste', 'hash'), { status: 503 });
    }
  }
});

test('rejeita formato inválido, versão desconhecida e base64 não canônico', () => {
  const dados = JSON.parse(criptografarSenha('senha-teste', 'hash'));
  for (const registro of ['null', '{}', 'json inválido', JSON.stringify({ ...dados, v: 2 }), JSON.stringify({ ...dados, tag: dados.tag.replace(/=+$/, '') })]) {
    assert.throws(() => descriptografarSenha(registro, 'hash'), { status: 503 });
  }
});

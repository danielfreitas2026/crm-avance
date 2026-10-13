const crypto = require('node:crypto');

function erroCofre() {
  const error = new Error('Gerenciador de senhas temporariamente indisponível.');
  error.status = 503;
  error.code = 'PASSWORD_VAULT_UNAVAILABLE';
  return error;
}

function decodificarBase64(valor, tamanho) {
  if (valor === '' && tamanho === undefined) return Buffer.alloc(0);
  if (typeof valor !== 'string' || !valor || !/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) throw erroCofre();
  const buffer = Buffer.from(valor, 'base64');
  if (buffer.toString('base64') !== valor || (tamanho !== undefined && buffer.length !== tamanho)) throw erroCofre();
  return buffer;
}

function obterChave() {
  return decodificarBase64(process.env.CRM_PASSWORD_VAULT_KEY, 32);
}

function criptografarSenha(senha, hash) {
  const chave = obterChave();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(hash, 'utf8'));
  const conteudo = Buffer.concat([cipher.update(senha, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    conteudo: conteudo.toString('base64')
  });
}

function descriptografarSenha(registro, hash) {
  try {
    const chave = obterChave();
    const dados = JSON.parse(registro);
    if (dados.v !== 1) throw erroCofre();
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave, decodificarBase64(dados.iv, 12), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(hash, 'utf8'));
    decipher.setAuthTag(decodificarBase64(dados.tag, 16));
    return Buffer.concat([decipher.update(decodificarBase64(dados.conteudo)), decipher.final()]).toString('utf8');
  } catch {
    throw erroCofre();
  }
}

module.exports = { obterChave, criptografarSenha, descriptografarSenha, erroCofre };

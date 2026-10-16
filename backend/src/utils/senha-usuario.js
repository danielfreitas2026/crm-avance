const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

function obterChave() {
  const valor = process.env.USUARIO_SENHA_ENCRYPTION_KEY || '';
  const chave = Buffer.from(valor, 'base64');
  if (chave.length !== 32 || chave.toString('base64') !== valor) {
    throw new Error('Chave de criptografia de senhas ausente ou inválida.');
  }
  return chave;
}

async function prepararSenha(senha) {
  if (typeof senha !== 'string' || senha.length === 0) {
    throw new Error('Senha inválida.');
  }
  const chave = obterChave();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, nonce);
  const conteudo = Buffer.concat([cipher.update(senha, 'utf8'), cipher.final()]);
  return {
    senha: await bcrypt.hash(senha, 10),
    senha_criptografada: ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), conteudo.toString('base64')].join(':')
  };
}

function recuperarSenha(valor) {
  try {
    const chave = obterChave();
    const partes = valor.split(':');
    if (partes.length !== 4 || partes[0] !== 'v1') throw new Error();
    const buffers = partes.slice(1).map(parte => {
      const buffer = Buffer.from(parte, 'base64');
      if (buffer.toString('base64') !== parte) throw new Error();
      return buffer;
    });
    const [nonce, tag, conteudo] = buffers;
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(conteudo), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Não foi possível recuperar a senha.');
  }
}

module.exports = { prepararSenha, recuperarSenha };

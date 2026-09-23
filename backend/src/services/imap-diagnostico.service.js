const tls = require('node:tls');
const https = require('node:https');

const HOST_IMAP = 'imap.uhserver.com';
const PORTA_IMAP = 993;
const TIMEOUT_MS = 10000;

function testarImap(conectar = tls.connect) {
  return new Promise((resolve, reject) => {
    const socket = conectar({
      host: HOST_IMAP,
      port: PORTA_IMAP,
      servername: HOST_IMAP,
      timeout: TIMEOUT_MS
    }, () => {
      socket.end();
      resolve({ host: HOST_IMAP, porta: PORTA_IMAP, tls: true });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error('Tempo esgotado ao estabelecer a conexão TLS.'), { code: 'CONNECT_TIMEOUT' }));
    });
    socket.once('error', reject);
  });
}

function consultarIpSaida(obter = https.get) {
  return new Promise((resolve, reject) => {
    const request = obter('https://api.ipify.org', { timeout: TIMEOUT_MS }, response => {
      let ip = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { ip += chunk; });
      response.on('end', () => resolve(ip.trim() || null));
    });
    request.once('timeout', () => request.destroy(Object.assign(new Error('Tempo esgotado ao consultar o IP de saída.'), { code: 'IP_TIMEOUT' })));
    request.once('error', reject);
  });
}

function falha(error) {
  return {
    ok: false,
    codigo: String(error?.code || 'ERRO_DESCONHECIDO').slice(0, 100),
    mensagem: String(error?.message || 'Falha desconhecida.').replace(/\s+/g, ' ').trim().slice(0, 300)
  };
}

async function executarDiagnostico(dependencias = {}) {
  const testar = dependencias.testarImap || testarImap;
  const consultar = dependencias.consultarIpSaida || consultarIpSaida;
  const [imap, ip] = await Promise.allSettled([testar(), consultar()]);
  return {
    executado_em: new Date().toISOString(),
    imap: imap.status === 'fulfilled' ? { ok: true, ...imap.value } : falha(imap.reason),
    ip_saida_https: ip.status === 'fulfilled'
      ? { ok: true, ip: ip.value }
      : falha(ip.reason)
  };
}

module.exports = { executarDiagnostico, _internals: { testarImap, consultarIpSaida, falha } };

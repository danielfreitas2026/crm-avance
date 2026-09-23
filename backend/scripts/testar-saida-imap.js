const tls = require('node:tls');
const https = require('node:https');

const HOST_IMAP = 'imap.uhserver.com';
const PORTA_IMAP = 993;
const TIMEOUT_MS = 10000;

function testarImap() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: HOST_IMAP,
      port: PORTA_IMAP,
      servername: HOST_IMAP,
      timeout: TIMEOUT_MS
    });

    socket.once('secureConnect', () => {
      console.log(`Conexão TLS com ${HOST_IMAP}:${PORTA_IMAP} estabelecida.`);
      socket.end();
      resolve();
    });
    socket.once('timeout', () => {
      const error = Object.assign(new Error(`Tempo esgotado ao conectar com ${HOST_IMAP}:${PORTA_IMAP}.`), { code: 'CONNECT_TIMEOUT' });
      socket.destroy();
      reject(error);
    });
    socket.once('error', reject);
  });
}

function consultarIpSaida() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://api.ipify.org', { timeout: TIMEOUT_MS }, response => {
      let ip = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { ip += chunk; });
      response.on('end', () => {
        console.log(`IP de saída observado para HTTPS: ${ip.trim() || 'não informado'}`);
        resolve();
      });
    });
    request.once('timeout', () => request.destroy(Object.assign(new Error('Tempo esgotado ao consultar o IP de saída.'), { code: 'IP_TIMEOUT' })));
    request.once('error', reject);
  });
}

async function executar() {
  const [imap, ip] = await Promise.allSettled([testarImap(), consultarIpSaida()]);
  if (imap.status === 'rejected') {
    console.error('Falha na conexão TLS:', imap.reason?.code || imap.reason?.message || imap.reason);
    process.exitCode = 1;
  }
  if (ip.status === 'rejected') {
    console.error('Não foi possível consultar o IP de saída:', ip.reason?.code || ip.reason?.message || ip.reason);
  }
}

executar();

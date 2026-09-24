const dns = require('node:dns');
const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');

const HOST_IMAP = 'imap.uhserver.com';
const HOST_CONTROLE = 'portquiz.net';
const TIMEOUT_MS = 15000;

function erro(codigo, mensagem) {
  return Object.assign(new Error(mensagem), { code: codigo });
}

function testarTls(host = HOST_IMAP, porta = 993, conectar = tls.connect) {
  return new Promise((resolve, reject) => {
    const socket = conectar({ host, port: porta, servername: host, timeout: TIMEOUT_MS }, () => {
      socket.end();
      resolve({ host, porta, tls: true });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(erro('CONNECT_TIMEOUT', 'Tempo esgotado ao estabelecer a conexão TLS.'));
    });
    socket.once('error', reject);
  });
}

function testarTcp(host, porta, conectar = net.connect) {
  return new Promise((resolve, reject) => {
    const socket = conectar({ host, port: porta, timeout: TIMEOUT_MS }, () => {
      socket.end();
      resolve({ host, porta, tcp: true });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(erro('CONNECT_TIMEOUT', 'Tempo esgotado ao estabelecer a conexão TCP.'));
    });
    socket.once('error', reject);
  });
}

function testarStartTls(conectarTcp = net.connect, conectarTls = tls.connect) {
  return new Promise((resolve, reject) => {
    let concluido = false;
    let socketTcp;
    let socketTls;
    let buffer = '';
    let aguardandoResposta = false;

    const timer = setTimeout(() => finalizar(erro('CONNECT_TIMEOUT', 'Tempo esgotado durante a negociação STARTTLS.')), TIMEOUT_MS);

    function finalizar(falha, resultado) {
      if (concluido) return;
      concluido = true;
      clearTimeout(timer);
      if (falha) {
        if (socketTls && !socketTls.destroyed) socketTls.destroy();
        else if (socketTcp && !socketTcp.destroyed) socketTcp.destroy();
        reject(falha);
        return;
      }
      if (socketTls && !socketTls.destroyed) socketTls.end();
      resolve(resultado);
    }

    function aoReceber(dados) {
      buffer += dados.toString('utf8');
      if (buffer.length > 16384) {
        finalizar(erro('IMAP_RESPONSE_TOO_LARGE', 'Resposta IMAP excedeu o limite do diagnóstico.'));
        return;
      }
      if (!buffer.includes('\n')) return;

      if (!aguardandoResposta) {
        if (!/^\*\s+OK\b/im.test(buffer)) {
          finalizar(erro('IMAP_GREETING_INVALID', 'O servidor não enviou uma saudação IMAP válida.'));
          return;
        }
        buffer = '';
        aguardandoResposta = true;
        socketTcp.write('A001 STARTTLS\r\n');
        return;
      }

      if (/^A001\s+OK\b/im.test(buffer)) {
        socketTcp.removeListener('data', aoReceber);
        socketTcp.removeListener('error', aoErroTcp);
        socketTls = conectarTls({ socket: socketTcp, servername: HOST_IMAP }, () => {
          finalizar(null, { host: HOST_IMAP, porta: 143, tls: true, starttls: true });
        });
        socketTls.once('error', finalizar);
      } else if (/^A001\s+(?:NO|BAD)\b/im.test(buffer)) {
        finalizar(erro('STARTTLS_REJECTED', 'O servidor IMAP recusou o comando STARTTLS.'));
      }
    }

    function aoErroTcp(falha) {
      finalizar(falha);
    }

    socketTcp = conectarTcp({ host: HOST_IMAP, port: 143 }, () => {});
    socketTcp.on('data', aoReceber);
    socketTcp.once('error', aoErroTcp);
  });
}

async function resolverImap(resolver = dns.promises.lookup) {
  const enderecos = await resolver(HOST_IMAP, { all: true, verbatim: true });
  return {
    host: HOST_IMAP,
    enderecos: enderecos.map(({ address, family }) => ({ endereco: address, familia: Number(family) }))
  };
}

function consultarIpSaida(obter = https.get) {
  return new Promise((resolve, reject) => {
    const request = obter('https://api.ipify.org', { timeout: TIMEOUT_MS }, response => {
      let ip = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { ip += chunk; });
      response.on('end', () => resolve(ip.trim() || null));
    });
    request.once('timeout', () => request.destroy(erro('IP_TIMEOUT', 'Tempo esgotado ao consultar o IP de saída.')));
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

function resultado(promessa) {
  return promessa.status === 'fulfilled' ? { ok: true, ...promessa.value } : falha(promessa.reason);
}

async function executarDiagnostico(dependencias = {}) {
  const executar = tarefa => Promise.resolve().then(tarefa);
  const tarefas = [
    dependencias.resolverImap || resolverImap,
    dependencias.testarImap || testarTls,
    dependencias.testarStartTls || testarStartTls,
    dependencias.testarControle993 || (() => testarTcp(HOST_CONTROLE, 993)),
    dependencias.testarControle143 || (() => testarTcp(HOST_CONTROLE, 143)),
    dependencias.consultarIpSaida || consultarIpSaida
  ].map(executar);
  const [dnsImap, imap993, imap143, controle993, controle143, ip] = await Promise.allSettled(tarefas);

  return {
    executado_em: new Date().toISOString(),
    dns_imap: resultado(dnsImap),
    imap: resultado(imap993),
    imap_starttls: resultado(imap143),
    controles_tcp: {
      host: HOST_CONTROLE,
      porta_993: resultado(controle993),
      porta_143: resultado(controle143)
    },
    ip_saida_https: ip.status === 'fulfilled' ? { ok: true, ip: ip.value } : falha(ip.reason)
  };
}

module.exports = {
  executarDiagnostico,
  _internals: { testarTls, testarTcp, testarStartTls, resolverImap, consultarIpSaida, falha, resultado }
};

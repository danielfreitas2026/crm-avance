const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const diagnostico = require('../src/services/imap-diagnostico.service');

class SocketFalso extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.ended = false;
  }

  end() { this.ended = true; }
  destroy() { this.destroyed = true; }
}

test('diagnóstico combina DNS, transportes IMAP, controles TCP e IP do mesmo runtime', async () => {
  const resultado = await diagnostico.executarDiagnostico({
    resolverImap: async () => ({ host: 'imap.uhserver.com', enderecos: [{ endereco: '192.0.2.10', familia: 4 }] }),
    testarImap: async () => ({ host: 'imap.uhserver.com', porta: 993, tls: true }),
    testarStartTls: async () => ({ host: 'imap.uhserver.com', porta: 143, tls: true, starttls: true }),
    testarControle993: async () => ({ host: 'portquiz.net', porta: 993, tcp: true }),
    testarControle143: async () => ({ host: 'portquiz.net', porta: 143, tcp: true }),
    consultarIpSaida: async () => '203.0.113.10'
  });

  assert.ok(resultado.executado_em);
  assert.deepEqual(resultado.dns_imap, { ok: true, host: 'imap.uhserver.com', enderecos: [{ endereco: '192.0.2.10', familia: 4 }] });
  assert.deepEqual(resultado.imap, { ok: true, host: 'imap.uhserver.com', porta: 993, tls: true });
  assert.deepEqual(resultado.imap_starttls, { ok: true, host: 'imap.uhserver.com', porta: 143, tls: true, starttls: true });
  assert.deepEqual(resultado.controles_tcp, {
    host: 'portquiz.net',
    porta_993: { ok: true, host: 'portquiz.net', porta: 993, tcp: true },
    porta_143: { ok: true, host: 'portquiz.net', porta: 143, tcp: true }
  });
  assert.deepEqual(resultado.ip_saida_https, { ok: true, ip: '203.0.113.10' });
});

test('diagnóstico isola falhas parciais e limita os detalhes retornados', async () => {
  const timeout = async () => { throw Object.assign(new Error(`  ${'x'.repeat(400)}  `), { code: 'CONNECT_TIMEOUT' }); };
  const resultado = await diagnostico.executarDiagnostico({
    resolverImap: async () => { throw Object.assign(new Error('DNS indisponível'), { code: 'EAI_AGAIN' }); },
    testarImap: timeout,
    testarStartTls: timeout,
    testarControle993: timeout,
    testarControle143: timeout,
    consultarIpSaida: async () => { throw Object.assign(new Error('IP indisponível'), { code: 'IP_TIMEOUT' }); }
  });

  assert.deepEqual(resultado.dns_imap, { ok: false, codigo: 'EAI_AGAIN', mensagem: 'DNS indisponível' });
  assert.equal(resultado.imap.codigo, 'CONNECT_TIMEOUT');
  assert.equal(resultado.imap.mensagem.length, 300);
  assert.equal(resultado.imap_starttls.codigo, 'CONNECT_TIMEOUT');
  assert.equal(resultado.controles_tcp.porta_993.codigo, 'CONNECT_TIMEOUT');
  assert.equal(resultado.controles_tcp.porta_143.codigo, 'CONNECT_TIMEOUT');
  assert.deepEqual(resultado.ip_saida_https, { ok: false, codigo: 'IP_TIMEOUT', mensagem: 'IP indisponível' });
});

test('porta 143 exige resposta STARTTLS positiva e conclui o handshake TLS', async () => {
  const tcp = new SocketFalso();
  const tls = new SocketFalso();
  let comando = '';

  tcp.write = valor => {
    comando = valor;
    process.nextTick(() => tcp.emit('data', Buffer.from('A001 OK Begin TLS negotiation now\r\n')));
  };
  const conectarTcp = (opcoes, conectado) => {
    assert.deepEqual(opcoes, { host: 'imap.uhserver.com', port: 143 });
    process.nextTick(() => {
      conectado();
      tcp.emit('data', Buffer.from('* OK IMAP server ready\r\n'));
    });
    return tcp;
  };
  const conectarTls = (opcoes, conectado) => {
    assert.equal(opcoes.socket, tcp);
    assert.equal(opcoes.servername, 'imap.uhserver.com');
    process.nextTick(conectado);
    return tls;
  };

  const resultado = await diagnostico._internals.testarStartTls(conectarTcp, conectarTls);

  assert.equal(comando, 'A001 STARTTLS\r\n');
  assert.deepEqual(resultado, { host: 'imap.uhserver.com', porta: 143, tls: true, starttls: true });
  assert.equal(tls.ended, true);
});

test('porta 143 encerra o cliente quando o servidor recusa STARTTLS', async () => {
  const tcp = new SocketFalso();
  tcp.write = () => process.nextTick(() => tcp.emit('data', Buffer.from('A001 BAD STARTTLS unavailable\r\n')));
  const conectarTcp = (_opcoes, conectado) => {
    process.nextTick(() => {
      conectado();
      tcp.emit('data', Buffer.from('* OK IMAP server ready\r\n'));
    });
    return tcp;
  };

  await assert.rejects(
    diagnostico._internals.testarStartTls(conectarTcp),
    error => error.code === 'STARTTLS_REJECTED'
  );
  assert.equal(tcp.destroyed, true);
});

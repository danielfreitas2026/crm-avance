const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostico = require('../src/services/imap-diagnostico.service');

test('diagnóstico combina conexão IMAP e IP executados no mesmo runtime', async () => {
  const resultado = await diagnostico.executarDiagnostico({
    testarImap: async () => ({ host: 'imap.uhserver.com', porta: 993, tls: true }),
    consultarIpSaida: async () => '203.0.113.10'
  });

  assert.ok(resultado.executado_em);
  assert.deepEqual(resultado.imap, { ok: true, host: 'imap.uhserver.com', porta: 993, tls: true });
  assert.deepEqual(resultado.ip_saida_https, { ok: true, ip: '203.0.113.10' });
});

test('diagnóstico isola falhas parciais e limita o detalhe retornado', async () => {
  const resultado = await diagnostico.executarDiagnostico({
    testarImap: async () => { throw Object.assign(new Error(`  ${'x'.repeat(400)}  `), { code: 'CONNECT_TIMEOUT' }); },
    consultarIpSaida: async () => { throw Object.assign(new Error('IP indisponível'), { code: 'IP_TIMEOUT' }); }
  });

  assert.equal(resultado.imap.ok, false);
  assert.equal(resultado.imap.codigo, 'CONNECT_TIMEOUT');
  assert.equal(resultado.imap.mensagem.length, 300);
  assert.deepEqual(resultado.ip_saida_https, { ok: false, codigo: 'IP_TIMEOUT', mensagem: 'IP indisponível' });
});

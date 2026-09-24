const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretarEmailClaro, autenticarRemetente, normalizarNome } = require('../src/services/claro-email-parser.service');
const claroImap = require('../src/services/claro-imap.service');

const MODELOS = [
  ['O aceite do cliente EMPRESA ÁGIL É ENVIADO.\nIMPORTANTE: Verifique com seu cliente o recebimento.', 'aceite_enviado', 'aceite_biometria', false, false],
  ['O cliente EMPRESA ÁGIL ASSINOU o contrato.', 'contrato_assinado', 'aceite_biometria', true, false],
  ['O pedido do cliente EMPRESA ÁGIL foi APROVADO CREDITO.', 'credito_aprovado', 'apos_aceite_biometria', true, true],
  ['O pedido do cliente EMPRESA ÁGIL foi FATURADO.', 'pedido_faturado', 'etapa_final', true, true],
  ['O pedido do cliente EMPRESA ÁGIL está em Análise Claro.', 'analise_claro', 'sem_acao', false, false]
];

test('parser Claro reconhece os cinco modelos sem depender de caixa ou acentos', () => {
  for (const [corpo, acao, alvo, aceite, biometria] of MODELOS) {
    const resultado = interpretarEmailClaro('status de pedido - Empresa Ágil', corpo.toUpperCase());
    assert.equal(resultado.estrutura_valida, true);
    assert.equal(resultado.empresa_normalizada, 'empresa agil');
    assert.equal(resultado.acao, acao);
    assert.equal(resultado.alvo, alvo);
    assert.equal(resultado.marcar_aceite, aceite);
    assert.equal(resultado.marcar_biometria, biometria);
  }
  assert.equal(interpretarEmailClaro('Outro assunto', MODELOS[0][0]).estrutura_valida, false);
  assert.equal(normalizarNome('  Empresa Ágil S/A '), 'empresa agil s a');
});

test('parser Claro extrai a razão social após a saudação e decodifica entidades de espaço', () => {
  const corpo = 'Prezado BASARI TELECOM   &#x20;\nO aceite do cliente CAMISARIA BARRETO LTDA foi ENVIADO.   &#x20;\nIMPORTANTE: Verifique com seu cliente o recebimento.\nAtenciosamente, Equipe Husby';
  const resultado = interpretarEmailClaro('Status de Pedido', corpo);
  assert.equal(resultado.estrutura_valida, true);
  assert.equal(resultado.empresa, 'CAMISARIA BARRETO LTDA');
  assert.equal(resultado.empresa_normalizada, 'camisaria barreto ltda');
  assert.equal(resultado.acao, 'aceite_enviado');
  assert.equal(normalizarNome(' Camisária &amp; Barreto, Ltda. '), 'camisaria barreto ltda');
});

test('autenticação exige DKIM e DMARC pass alinhados ao domínio exato do remetente', () => {
  const headers = new Map([['authentication-results', 'mx.example; dkim=pass header.d=mailer.goalfy.com.br; dmarc=pass header.from=mailer.goalfy.com.br']]);
  assert.equal(autenticarRemetente(headers, 'no-reply@mailer.goalfy.com.br'), true);
  assert.equal(autenticarRemetente(headers, 'fraude@outro.example'), false);
  assert.equal(autenticarRemetente(new Map([['authentication-results', 'dkim=fail; dmarc=pass header.from=mailer.goalfy.com.br']]), 'no-reply@mailer.goalfy.com.br'), false);
});

function ambienteClaro() {
  const anterior = Object.fromEntries(Object.keys(process.env).filter(chave => chave.startsWith('CLARO_IMAP_')).map(chave => [chave, process.env[chave]]));
  Object.assign(process.env, {
    CLARO_IMAP_AUTOMATION_ENABLED: 'true', CLARO_IMAP_HOST: 'imap.uhserver.com', CLARO_IMAP_PORT: '993',
    CLARO_IMAP_SECURE: 'true', CLARO_IMAP_USER: 'automacao@example.com', CLARO_IMAP_PASSWORD: 'teste',
    CLARO_IMAP_ALLOWED_SENDERS: 'no-reply@mailer.goalfy.com.br', CLARO_IMAP_PROCESS_AFTER: '2026-09-01T00:00:00Z'
  });
  return () => {
    for (const chave of Object.keys(process.env).filter(nome => nome.startsWith('CLARO_IMAP_'))) delete process.env[chave];
    Object.assign(process.env, anterior);
  };
}

test('coletor abre INBOX read-only, busca UID ordenado e baixa fonte por BODY.PEEK sem comandos de escrita', async () => {
  const restaurar = ambienteClaro();
  const chamadas = [];
  const cursores = [];
  const inseridos = [];
  const mime = Buffer.from([
    'From: Hubsy <no-reply@mailer.goalfy.com.br>', 'Subject: STATUS DE PEDIDO', 'Date: Tue, 22 Sep 2026 12:00:00 +0000',
    'Message-ID: <claro-1@example.com>', 'Authentication-Results: mx; dkim=pass header.d=mailer.goalfy.com.br; dmarc=pass header.from=mailer.goalfy.com.br',
    'Content-Type: text/plain; charset=utf-8', '', 'O pedido do cliente EMPRESA TESTE foi APROVADO CREDITO.'
  ].join('\r\n'));
  const client = {
    mailbox: { uidValidity: 77n }, usable: true,
    async connect() { chamadas.push(['connect']); },
    async getMailboxLock(caixa, opcoes) { chamadas.push(['lock', caixa, opcoes]); return { release: () => chamadas.push(['release']) }; },
    async search(criterio, opcoes) { chamadas.push(['search', criterio, opcoes]); return [12, 11]; },
    async fetchOne(uid, query, opcoes) {
      chamadas.push(['fetch', uid, query, opcoes]);
      if (!query.source) return { envelope: { from: [{ address: 'no-reply@mailer.goalfy.com.br' }] }, internalDate: new Date('2026-09-22T12:00:00Z') };
      return { source: mime, envelope: { from: [{ address: 'no-reply@mailer.goalfy.com.br' }] }, internalDate: new Date('2026-09-22T12:00:00Z') };
    },
    async logout() { chamadas.push(['logout']); this.usable = false; }
  };
  try {
    const resultado = await claroImap.coletarEmailsClaro({}, {
      criarCliente: config => { assert.deepEqual({ host: config.host, port: config.port, secure: config.secure, connectionTimeout: config.connectionTimeout }, { host: 'imap.uhserver.com', port: 993, secure: true, connectionTimeout: 15000 }); return client; },
      obterEstado: async () => ({ uidvalidity: '77', ultimo_uid: 10 }),
      localizar: async () => null,
      salvarCursor: async (...args) => cursores.push(args.slice(0, 2)),
      inserir: async registro => { inseridos.push(registro); return { id: 1 }; }
    });
    assert.equal(resultado.coletados, 2);
    assert.deepEqual(chamadas.find(item => item[0] === 'lock'), ['lock', 'INBOX', { readOnly: true }]);
    assert.deepEqual(chamadas.filter(item => item[0] === 'fetch' && item[2].source).map(item => item[1]), [11, 12]);
    assert.ok(chamadas.filter(item => item[0] === 'fetch' && item[2].source).every(item => item[2].source === true));
    assert.equal(chamadas.some(item => ['store', 'move', 'copy', 'expunge', 'delete'].includes(item[0])), false);
    assert.deepEqual(cursores, [['77', 11], ['77', 12]]);
    assert.ok(inseridos.every(item => item.origem === 'imap_claro' && item.operadora === 'Claro' && item.autenticacao_valida));
  } finally { restaurar(); }
});

test('timeout no TLS direto tenta a porta 143 somente com STARTTLS obrigatório', async () => {
  const restaurar = ambienteClaro();
  const configuracoes = [];
  const encerramentos = [];
  const clientes = [
    {
      usable: false,
      async connect() { throw Object.assign(new Error('timeout'), { code: 'CONNECT_TIMEOUT' }); },
      close() { encerramentos.push('primario'); }
    },
    {
      mailbox: { uidValidity: 10n }, usable: true,
      async connect() {},
      async getMailboxLock() { return { release: () => encerramentos.push('lock') }; },
      async search() { return []; },
      async logout() { encerramentos.push('fallback'); this.usable = false; }
    }
  ];
  try {
    const resultado = await claroImap.coletarEmailsClaro({}, {
      criarCliente: config => { configuracoes.push(config); return clientes[configuracoes.length - 1]; },
      obterEstado: async () => ({ uidvalidity: '10', ultimo_uid: 0 }),
      salvarCursor: async () => {}
    });

    assert.equal(resultado.coletados, 0);
    assert.deepEqual(configuracoes.map(config => ({
      port: config.port,
      secure: config.secure,
      doSTARTTLS: config.doSTARTTLS,
      connectionTimeout: config.connectionTimeout
    })), [
      { port: 993, secure: true, doSTARTTLS: undefined, connectionTimeout: 15000 },
      { port: 143, secure: false, doSTARTTLS: true, connectionTimeout: 15000 }
    ]);
    assert.deepEqual(encerramentos, ['primario', 'lock', 'fallback']);
  } finally { restaurar(); }
});

test('falhas de autenticação e certificado não tentam STARTTLS alternativo', async () => {
  for (const falha of [
    Object.assign(new Error('Command failed'), { code: 'AUTHENTICATIONFAILED', authenticationFailed: true }),
    Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' })
  ]) {
    let criados = 0;
    let fechados = 0;
    await assert.rejects(
      claroImap._internals.conectarCliente(
        { host: 'imap.example', port: 993, secure: true, auth: { user: 'conta', pass: 'senha' }, connectionTimeout: 15000 },
        () => {
          criados += 1;
          return { usable: false, async connect() { throw falha; }, close() { fechados += 1; } };
        }
      ),
      error => error === falha
    );
    assert.equal(criados, 1);
    assert.equal(fechados, 1);
  }
});

test('falha nos dois transportes informa as portas sem incluir credenciais', async () => {
  const falhas = [
    Object.assign(new Error('password=segredo-primario'), { code: 'CONNECT_TIMEOUT' }),
    Object.assign(new Error('conta@example.com password=segredo-fallback'), { code: 'ETIMEDOUT' })
  ];
  let indice = 0;

  await assert.rejects(
    claroImap._internals.conectarCliente(
      { host: 'imap.example', port: 993, secure: true, auth: { user: 'conta@example.com', pass: 'senha-real' }, connectionTimeout: 15000 },
      () => {
        const falha = falhas[indice++];
        return { usable: false, async connect() { throw falha; }, close() {} };
      }
    ),
    error => error.code === 'IMAP_CONNECTION_FAILED'
      && /993: CONNECT_TIMEOUT/.test(error.message)
      && /143: ETIMEDOUT/.test(error.message)
      && !/conta@example\.com|segredo|senha-real/.test(error.message)
  );
});

test('remetente fora da allowlist é ignorado antes de baixar ou persistir o conteúdo', async () => {
  const restaurar = ambienteClaro();
  let baixouCorpo = false;
  let persistiu = false;
  const client = {
    mailbox: { uidValidity: 9n }, usable: true,
    async connect() {}, async getMailboxLock() { return { release() {} }; }, async search() { return [1]; },
    async fetchOne(uid, query) { if (query.source) baixouCorpo = true; return { envelope: { from: [{ address: 'pessoa@example.com' }] } }; },
    async logout() { this.usable = false; }
  };
  try {
    const resultado = await claroImap.coletarEmailsClaro({}, {
      criarCliente: () => client, obterEstado: async () => null, salvarCursor: async () => {},
      localizar: async () => null,
      inserir: async () => { persistiu = true; }
    });
    assert.equal(resultado.ignorados, 1);
    assert.equal(baixouCorpo, false);
    assert.equal(persistiu, false);
  } finally { restaurar(); }
});

test('mensagem sem Message-ID usa fallback estável e não duplica após repetição', async () => {
  const existentes = new Set();
  const dados = {
    uid: 3, uidvalidity: '8', envelope: { from: [{ address: 'no-reply@mailer.goalfy.com.br' }] },
    internalDate: new Date('2026-09-22T12:00:00Z'), source: Buffer.from('conteudo-estavel')
  };
  const dependencias = {
    remetentes: new Set(['no-reply@mailer.goalfy.com.br']),
    parse: async () => ({
      from: { value: [{ address: 'no-reply@mailer.goalfy.com.br' }], text: 'Hubsy <no-reply@mailer.goalfy.com.br>' },
      subject: 'STATUS DE PEDIDO', text: 'O cliente EMPRESA TESTE ASSINOU o contrato.', headers: new Map(), date: dados.internalDate
    }),
    localizar: async chave => existentes.has(chave) ? { id: 1 } : null,
    inserir: async registro => { existentes.add(registro.chave_deduplicacao); return { id: 1 }; }
  };
  const primeira = await claroImap.registrarMensagem(dados, dependencias);
  const repetida = await claroImap.registrarMensagem(dados, dependencias);
  assert.equal(primeira.persistida, true);
  assert.equal(repetida.persistida, false);
  assert.equal(existentes.size, 1);
});

test('troca de UIDVALIDITY ignora o cursor antigo e refaz a busca limitada pela data', async () => {
  const restaurar = ambienteClaro();
  const consultados = [];
  const client = {
    mailbox: { uidValidity: 200n }, usable: true,
    async connect() {}, async getMailboxLock() { return { release() {} }; }, async search() { return [2]; },
    async fetchOne(uid) { consultados.push(uid); return { envelope: { from: [{ address: 'pessoa@example.com' }] } }; },
    async logout() { this.usable = false; }
  };
  try {
    await claroImap.coletarEmailsClaro({}, {
      criarCliente: () => client,
      obterEstado: async () => ({ uidvalidity: '100', ultimo_uid: 999 }),
      salvarCursor: async () => {}, localizar: async () => null
    });
    assert.deepEqual(consultados, [2]);
  } finally { restaurar(); }
});

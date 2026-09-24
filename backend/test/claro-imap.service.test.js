const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { dkimSign } = require('mailauth/lib/dkim/sign');
const { interpretarEmailClaro, normalizarNome } = require('../src/services/claro-email-parser.service');
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

test('parser Claro reconhece os seis exemplos com o assunto Atualização de pedido', () => {
  const exemplos = [
    ['O pedido do cliente ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA \u00a0foi APROVADO CRÉDITO.', 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA', 'credito_aprovado'],
    ['O aceite do cliente POUSADA SOLMAIOR CONSERVATORIA LTDA foi ENVIADO.', 'POUSADA SOLMAIOR CONSERVATORIA LTDA', 'aceite_enviado'],
    ['O cliente ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA \u00a0ASSINOU o contrato.', 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA', 'contrato_assinado'],
    ['O aceite do cliente COLEGIO E CURSO JOAQUIM GOMES DE SOUZA LTDA foi ENVIADO.', 'COLEGIO E CURSO JOAQUIM GOMES DE SOUZA LTDA', 'aceite_enviado'],
    ['O aceite do cliente ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA foi ENVIADO.', 'ALFHA AMBIENTAL SOLUCOES E SERVICOS LTDA', 'aceite_enviado'],
    ['O aceite do cliente XYZ PECAS & ACESSORIOS LTDA foi ENVIADO.', 'XYZ PECAS & ACESSORIOS LTDA', 'aceite_enviado']
  ];
  for (const [frase, empresa, acao] of exemplos) {
    const corpo = `Prezado BASARI TELECOM    ${frase}    IMPORTANTE: Verifique com seu cliente o recebimento.    Atenciosamente, Equipe Husby  Seu melhor parceiro de negócios !`;
    const resultado = interpretarEmailClaro('Atualização de pedido', corpo);
    assert.equal(resultado.estrutura_valida, true);
    assert.equal(resultado.empresa, empresa);
    assert.equal(resultado.empresa_normalizada, normalizarNome(empresa));
    assert.equal(resultado.acao, acao);
  }
  assert.equal(interpretarEmailClaro('ATUALIZACAO DE PEDIDO', `Prezado BASARI TELECOM ${exemplos[0][0]}`).estrutura_valida, true);
  assert.equal(interpretarEmailClaro('Outro assunto', exemplos[0][0]).estrutura_valida, false);
});

test('verifica criptograficamente DKIM do MIME, rejeitando adulteração e domínio desalinhado', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const original = Buffer.from('From: <no-reply@mailer.example.com>\r\nSubject: Atualização de pedido\r\n\r\nO cliente EMPRESA TESTE ASSINOU o contrato.\r\n');
  const chave = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const resolverDns = async () => [[`v=DKIM1; k=rsa; p=${chave}`]];
  const remetentes = new Set(['no-reply@mailer.example.com']);
  async function assinar(dominio) {
    const resultado = await dkimSign(original, { signatureData: [{ signingDomain: dominio, selector: 'teste', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }] });
    assert.deepEqual(resultado.errors, []);
    return Buffer.concat([Buffer.from(resultado.signatures), original]);
  }
  const assinado = await assinar('mailer.example.com');
  assert.equal((await claroImap._internals.verificarOrigem(assinado, 'no-reply@mailer.example.com', { resolverDns, remetentes })).valida, true);
  const adulterado = Buffer.from(assinado.toString().replace('EMPRESA TESTE', 'EMPRESA FALSA'));
  assert.equal((await claroImap._internals.verificarOrigem(adulterado, 'no-reply@mailer.example.com', { resolverDns, remetentes })).valida, false);
  const cabecalhoFalso = Buffer.from('From: <no-reply@mailer.example.com>\r\nAuthentication-Results: mx; dkim=pass header.d=mailer.example.com; dmarc=pass header.from=mailer.example.com\r\n\r\nTexto');
  assert.equal((await claroImap._internals.verificarOrigem(cabecalhoFalso, 'no-reply@mailer.example.com', { resolverDns, remetentes })).valida, false);
  const desalinhado = await assinar('outro.example.com');
  assert.equal((await claroImap._internals.verificarOrigem(desalinhado, 'no-reply@mailer.example.com', { resolverDns, remetentes })).valida, false);
  assert.equal((await claroImap._internals.verificarOrigem(null, 'no-reply@mailer.example.com', { resolverDns, remetentes })).valida, false);
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
      verificarDkim: async () => ({ results: [{ status: { result: 'pass' }, signingDomain: 'mailer.goalfy.com.br' }] }),
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

test('rebusca original antigo no IMAP somente leitura e rejeita ausência ou divergência', async () => {
  const restaurar = ambienteClaro();
  const chamadas = [];
  const source = Buffer.from('From: <no-reply@mailer.goalfy.com.br>\r\nSubject: Atualização de pedido\r\nMessage-ID: <antigo@example.com>\r\n\r\nO cliente EMPRESA TESTE ASSINOU o contrato.\r\n');
  const registro = { id: 1, identificador_remoto: '<antigo@example.com>', assunto: 'Atualização de pedido', corpo_hash: require('node:crypto').createHash('sha256').update('O cliente EMPRESA TESTE ASSINOU o contrato.').digest('hex') };
  const client = {
    usable: true, mailbox: { uidValidity: 7n },
    async connect() {},
    async getMailboxLock(nome, opcoes) { chamadas.push([nome, opcoes]); return { release() {} }; },
    async search(criterio, opcoes) { chamadas.push([criterio, opcoes]); return [15]; },
    async fetchOne(uid, query, opcoes) { chamadas.push([uid, query, opcoes]); return { source, envelope: { from: [{ address: 'no-reply@mailer.goalfy.com.br' }] } }; },
    async logout() { this.usable = false; }
  };
  const deps = { criarCliente: () => client, verificarDkim: async () => ({ results: [{ status: { result: 'pass' }, signingDomain: 'mailer.goalfy.com.br' }] }) };
  try {
    assert.equal((await claroImap.verificarRegistrosOriginais([registro], deps)).get(1).valida, true);
    assert.deepEqual(chamadas[0], ['INBOX', { readOnly: true }]);
    assert.deepEqual(chamadas[2], [15, { source: true, envelope: true, internalDate: true }, { uid: true }]);
    assert.equal((await claroImap.verificarRegistrosOriginais([{ ...registro, corpo_hash: 'outro' }], deps)).get(1).valida, false);
    assert.equal((await claroImap.verificarRegistrosOriginais([{ ...registro, identificador_remoto: '8:15' }], deps)).get(1).valida, false);
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

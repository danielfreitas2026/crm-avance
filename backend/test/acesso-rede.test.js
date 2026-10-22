const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const express = require('express');
const db = require('../src/config/database');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const rede = require('../src/services/acesso-rede.service');
const auth = require('../src/services/auth.service');
const horario = require('../src/services/horario-acesso.service');
const telegram = require('../src/services/telegram.service');
const auditoria = require('../src/services/audit-log.service');
const { normalizarIp, validarRedes, pertenceRede, configurarProxy } = require('../src/utils/rede');

// Persistência isolada, com snapshots e transações serializadas. O serviço real
// pede bloqueios e usa seu próprio relógio, HMAC, JWT e envio (simulado).
async function banco(t) {
  let estado = { configuracoes_acesso_rede: [{ id: 1, ativo: true, redes: '["203.0.113.10","2001:db8:1234::/48"]' }],
    acesso_rede_solicitacoes: [], usuarios: [{ id: 1, nome: 'Ana', email: 'ana@crm.local',
      senha: await bcrypt.hash('Senha123', 4), role_id: 2, role: { nome: 'usuario', permissoes: '{}' },
      permissoes: '[]', ativo: true, versao_sessao: 0 }] };
  let fila = Promise.resolve();
  const envios = [], eventos = [], bloqueios = [];
  process.env.TELEGRAM_BOT_TOKEN = 'teste-local';
  process.env.TELEGRAM_ACESSO_REDE_CHAT_ID = 'administracao-teste';
  t.after(() => { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_ACESSO_REDE_CHAT_ID; });
  function query(tabela, trx) {
    const filtros = [];
    let unico = false, operacao, dados, contar = false;
    const q = {
      where(campo, operador, valor) {
        if (typeof campo === 'object') for (const [chave, item] of Object.entries(campo)) this.where(chave, item);
        else if (valor === undefined) filtros.push(row => row[campo] === operador);
        else if (operador === '>') filtros.push(row => new Date(row[campo]).getTime() > new Date(valor).getTime());
        else assert.fail(`Operador inesperado: ${operador}`);
        return this;
      },
      whereIn(campo, valores) { filtros.push(row => valores.includes(row[campo])); return this; },
      first() { unico = true; return this; },
      findById(id) { unico = true; return this.where({ id }); },
      withGraphFetched() { return this; },
      forUpdate() { assert.ok(trx, 'bloqueio exige transação'); bloqueios.push(tabela); return this; },
      orderBy() { return this; },
      count() { contar = true; return this; },
      insert(valor) { operacao = 'insert'; dados = valor; return this; },
      update(valor) { operacao = 'update'; dados = valor; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const linhas = (trx ? trx.estado : estado)[tabela];
          if (operacao === 'insert') { linhas.push(structuredClone(dados)); return [dados.id]; }
          const encontrados = linhas.filter(row => filtros.every(f => f(row)));
          if (contar) return unico ? { total: encontrados.length } : [{ total: encontrados.length }];
          if (operacao === 'update') { encontrados.forEach(row => Object.assign(row, structuredClone(dados))); return encontrados.length; }
          const copias = encontrados.map(row => tabela === 'usuarios' ? Usuario.fromJson(structuredClone(row)) : structuredClone(row));
          return unico ? copias[0] : copias;
        }).then(resolve, reject);
      }
    };
    return q;
  }
  t.mock.method(db, 'transaction', callback => {
    const executar = fila.then(async () => {
      const trx = tabela => query(tabela, trx);
      trx.estado = structuredClone(estado);
      const resultado = await callback(trx);
      estado = trx.estado;
      return resultado;
    });
    fila = executar.catch(() => {});
    return executar;
  });
  t.mock.method(db.client, 'acquireConnection', async () => ({}));
  t.mock.method(db.client, 'releaseConnection', async () => {});
  t.mock.method(db.client, '_query', async (_conexao, consulta) => {
    let rows;
    if (consulta.sql.includes('`configuracoes_acesso_rede`')) rows = structuredClone(estado.configuracoes_acesso_rede);
    else if (consulta.sql.includes('`acesso_rede_solicitacoes`')) rows = structuredClone(estado.acesso_rede_solicitacoes.filter(row => row.id === consulta.bindings[0]));
    else assert.fail(`Consulta inesperada: ${consulta.sql}`);
    return { ...consulta, response: [rows, []] };
  });
  t.mock.method(Usuario, 'query', trx => query('usuarios', trx));
  t.mock.method(Permissao, 'query', () => ({ where() { return this; }, orderBy: async () => [{ chave: 'acesso_rede_sem_codigo' }] }));
  t.mock.method(telegram, 'enviarCodigoAcessoRede', async dados => { envios.push(dados); });
  t.mock.method(auditoria, 'registrar', async (_req, evento) => { eventos.push(evento); });
  t.mock.method(auditoria, 'registrarSemBloquear', async () => {});
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: true, versao_sessao: estado.usuarios[0].versao_sessao }));
  return { get estado() { return estado; }, get usuario() { return estado.usuarios[0]; },
    get config() { return estado.configuracoes_acesso_rede[0]; }, envios, eventos, bloqueios,
    req: { ip: '198.51.100.15', headers: {} },
    async solicitar(sessao) {
      let falha;
      try { await rede.avaliar(this.usuario, this.req, sessao); } catch (error) { falha = error; }
      assert.equal(falha?.status, 403);
      assert.equal(falha.code, 'NETWORK_ACCESS_REQUIRED');
      return falha.detalhes;
    },
    validar(id, codigo = envios.at(-1).codigo) { return rede.validar({ solicitacao_id: id, codigo }, this.req); }
  };
}

test('redes validam IP/CIDR, normalizam IPv4 mapeado e reconhecem IPv4/IPv6 sem confiar em texto', () => {
  assert.equal(normalizarIp('::ffff:203.0.113.10'), '203.0.113.10');
  assert.equal(pertenceRede('::ffff:203.0.113.10', ['203.0.113.0/24']), true);
  assert.equal(pertenceRede('2001:db8:1234::abc', ['2001:db8:1234::/48']), true);
  assert.equal(pertenceRede('2001:db8:5678::1', ['2001:db8:1234::/48']), false);
  assert.equal(pertenceRede('invalido', ['203.0.113.10']), false);
  for (const redes of [['0.0.0.0/0'], ['::/0'], ['1.2.3.4/33'], ['::1/129'], ['1.2.3.4/'], ['example.com'], ['1.2.3.4/24/x'], [12], null]) {
    assert.throws(() => validarRedes(redes));
  }
});

test('proxy ignora X-Forwarded-For forjado e só aceita encaminhamento do proxy listado', async t => {
  const app = express();
  configurarProxy(app, '');
  app.get('/', (req, res) => res.json({ ip: normalizarIp(req.ip) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).json()).ip, '127.0.0.1');
  configurarProxy(app, '127.0.0.1/32');
  assert.equal((await (await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).json()).ip, '203.0.113.10');
  configurarProxy(app, '192.0.2.5');
  assert.equal((await (await fetch(url, { headers: { 'X-Forwarded-For': '203.0.113.10' } })).json()).ip, '127.0.0.1');
  assert.throws(() => configurarProxy(app, 'true'));
});

test('rede interna, função desativada, admins e permissão individual ou de perfil dispensam o código', async t => {
  const b = await banco(t);
  await rede.avaliar(b.usuario, { ip: '203.0.113.10' });
  await rede.avaliar(b.usuario, { ip: '2001:db8:1234::10' });
  b.config.ativo = false;
  await rede.avaliar(b.usuario, b.req);
  b.config.ativo = true;
  b.usuario.role.nome = 'admin';
  b.usuario.permissoes = '{"acesso_rede_sem_codigo":false}';
  await rede.avaliar(b.usuario, b.req);
  await rede.avaliar(b.usuario, { ip: 'IP indisponível' });
  assert.equal(rede.dispensado(b.usuario), true);
  b.usuario.role.nome = 'usuario';
  assert.equal(rede.dispensado(b.usuario), false);
  b.usuario.permissoes = '["acesso_rede_sem_codigo"]';
  await rede.avaliar(b.usuario, b.req);
  b.usuario.permissoes = '[]';
  b.usuario.role.permissoes = '{"acesso_rede_sem_codigo":true}';
  await rede.avaliar(b.usuario, b.req);
  assert.equal(b.envios.length, 0);
  b.usuario.role.permissoes = '{}';
  await b.solicitar();
  assert.equal(b.envios.length, 1);
});

test('login só solicita após senha válida, não emite JWT pendente e aprova com seis letras de uso único', async t => {
  const b = await banco(t);
  await assert.rejects(auth.login(b.usuario.email, 'errada', b.req), /inválidos/);
  assert.equal(b.envios.length, 0);
  let pendente;
  await assert.rejects(auth.login(b.usuario.email, 'Senha123', b.req), error => {
    pendente = error.detalhes;
    assert.equal(pendente.token, undefined);
    return error.status === 403;
  });
  assert.match(b.envios[0].codigo, /^[A-Z]{6}$/);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].codigo_hash.includes(b.envios[0].codigo), false);
  assert.equal(JSON.stringify(b.eventos).includes(b.envios[0].codigo), false);
  const sessao = await b.validar(pendente.solicitacao_id, b.envios[0].codigo.toLowerCase());
  const decoded = jwt.verify(sessao.token, process.env.JWT_SECRET);
  assert.ok(decoded.jti);
  assert.equal(sessao.usuario.senha, undefined);
  await rede.avaliarSessao(b.req, decoded, sessao.token);
  await assert.rejects(b.validar(pendente.solicitacao_id), /inválida ou expirada/);
  assert.deepEqual(b.bloqueios.slice(0, 2), ['configuracoes_acesso_rede', 'usuarios']);
});

test('chamadas concorrentes deduplicam emissão e apenas um consumo do código vence', async t => {
  const b = await banco(t);
  const sessao = { id: 'sessao-existente', exp: Math.floor(Date.now() / 1000) + 1800 };
  const respostas = await Promise.all([b.solicitar(sessao), b.solicitar(sessao), b.solicitar(sessao)]);
  assert.equal(new Set(respostas.map(row => row.solicitacao_id)).size, 1);
  assert.equal(b.envios.length, 1);
  const resultados = await Promise.allSettled([b.validar(respostas[0].solicitacao_id), b.validar(respostas[0].solicitacao_id)]);
  assert.equal(resultados.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(jwt.decode(resultados.find(row => row.status === 'fulfilled').value.token).exp, sessao.exp);
});

test('novo código vale 30 minutos, informa o prazo no Telegram e pode ser usado após 29 minutos', async t => {
  const enviarReal = telegram.enviarCodigoAcessoRede;
  const b = await banco(t);
  const { solicitacao_id, expira_em } = await b.solicitar();
  const row = b.estado.acesso_rede_solicitacoes[0];
  assert.equal(new Date(expira_em).getTime() - row.created_at.getTime(), 30 * 60000);
  let mensagem;
  t.mock.method(require('axios'), 'post', async (_url, dados) => {
    mensagem = dados;
    return { data: { ok: true, result: { message_id: 1 } } };
  });
  await enviarReal(b.envios[0]);
  assert.equal(mensagem.chat_id, 'administracao-teste');
  assert.match(mensagem.text, /Válido por 30 minutos/);
  let agora = new Date(expira_em).getTime();
  t.mock.method(Date, 'now', () => agora);
  await assert.rejects(b.validar(solicitacao_id), /expirada/);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'pendente');
  agora = row.created_at.getTime() + 29 * 60000;
  const sessao = await b.validar(solicitacao_id);
  assert.equal(jwt.verify(sessao.token, process.env.JWT_SECRET).id, b.usuario.id);
  await assert.rejects(b.validar(solicitacao_id), /inválida ou expirada/);
});

test('cinco erros persistem e bloqueiam, inclusive código com formato inválido', async t => {
  const b = await banco(t);
  const { solicitacao_id } = await b.solicitar();
  for (let i = 0; i < 5; i++) await assert.rejects(b.validar(solicitacao_id, '123'), /incorreto|Limite/);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].tentativas, 5);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'bloqueado');
  await assert.rejects(b.validar(solicitacao_id), /inválida ou expirada/);
});

test('código rejeita outro IP, prazo vencido/inválido, sessão expirada, conta inativa e versão revogada', async t => {
  const b = await banco(t);
  const { solicitacao_id } = await b.solicitar();
  const row = b.estado.acesso_rede_solicitacoes[0];
  b.req.ip = '198.51.100.16';
  await assert.rejects(b.validar(solicitacao_id), /inválida/);
  b.req.ip = row.ip;
  for (const prazo of [new Date(Date.now() - 1), 'data inválida']) {
    b.estado.acesso_rede_solicitacoes[0].expira_em = prazo;
    await assert.rejects(b.validar(solicitacao_id), /expirada/);
  }
  b.estado.acesso_rede_solicitacoes[0].expira_em = new Date(Date.now() + 60000);
  b.estado.acesso_rede_solicitacoes[0].sessao_expira_em = new Date(Date.now() - 1);
  await assert.rejects(b.validar(solicitacao_id), /expirada/);
  b.estado.acesso_rede_solicitacoes[0].sessao_expira_em = null;
  b.usuario.versao_sessao++;
  await assert.rejects(b.validar(solicitacao_id), /expirada/);
  b.usuario.versao_sessao = 0;
  b.usuario.ativo = false;
  await assert.rejects(b.validar(solicitacao_id), /expirada/);
});

test('horário fechado impede aprovação e não consome o código', async t => {
  const b = await banco(t);
  const { solicitacao_id } = await b.solicitar();
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: false, motivo: 'SYSTEM_CLOSED' }));
  await assert.rejects(b.validar(solicitacao_id), error => error.status === 423 && error.code === 'SYSTEM_CLOSED');
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'pendente');
});

test('mudança de IP, logout e versão de sessão encerram liberação; JWT antigo continua identificável', async t => {
  const b = await banco(t);
  const token = jwt.sign({ id: 1, versao_sessao: 0 }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const decoded = jwt.decode(token);
  assert.equal(rede.identificarSessao(decoded, token).length, 64);
  const pendente = await b.solicitar({ id: rede.identificarSessao(decoded, token), exp: decoded.exp });
  const sessao = await b.validar(pendente.solicitacao_id);
  assert.equal(jwt.decode(sessao.token).exp, decoded.exp);
  await rede.avaliarSessao(b.req, jwt.decode(sessao.token), sessao.token);
  // Uma segunda rede exige outro código, sem reaproveitar a aprovação anterior.
  b.req.ip = '198.51.100.20';
  await assert.rejects(rede.avaliarSessao(b.req, jwt.decode(sessao.token), sessao.token), error => error.status === 403 && error.code === 'NETWORK_ACCESS_REQUIRED');
  b.req.ip = '198.51.100.15';
  b.req.headers.authorization = `Bearer ${sessao.token}`;
  await rede.logout(b.req);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'revogado');
  await assert.rejects(rede.avaliarSessao(b.req, jwt.decode(sessao.token), sessao.token), error => error.status === 403 && error.code === 'NETWORK_ACCESS_REQUIRED');
});

test('aprovar uma segunda rede substitui a liberação anterior da mesma sessão sem ampliar validade', async t => {
  const b = await banco(t);
  const { solicitacao_id } = await b.solicitar();
  const primeira = await b.validar(solicitacao_id);
  const decoded = jwt.decode(primeira.token);
  b.estado.acesso_rede_solicitacoes[0].created_at = new Date(Date.now() - 120000);
  b.req.ip = '198.51.100.20';
  const segunda = await b.solicitar({ id: decoded.jti, exp: decoded.exp });
  const aprovada = await b.validar(segunda.solicitacao_id);
  assert.equal(jwt.decode(aprovada.token).exp, decoded.exp);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'revogado');
  assert.equal(b.estado.acesso_rede_solicitacoes[1].estado, 'aprovado');
  await rede.avaliarSessao(b.req, jwt.decode(aprovada.token), aprovada.token);
  b.req.ip = '198.51.100.15';
  await assert.rejects(rede.avaliarSessao(b.req, decoded, primeira.token), error => error.status === 403 && error.code === 'NETWORK_ACCESS_REQUIRED');
  b.usuario.versao_sessao++;
  b.req.ip = '198.51.100.20';
  await assert.rejects(rede.avaliarSessao(b.req, decoded, primeira.token), error => error.status === 401);
});

test('falha Telegram mantém bloqueio, não salva código utilizável e respeita cota de nova emissão', async t => {
  const b = await banco(t);
  t.mock.method(telegram, 'enviarCodigoAcessoRede', async () => { throw new Error('segredo-do-transporte'); });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(rede.avaliar(b.usuario, b.req), error => error.status === 503 && !error.message.includes('segredo'));
  }
  assert.equal(b.estado.acesso_rede_solicitacoes.length, 3);
  assert.equal(b.estado.acesso_rede_solicitacoes.every(row => row.estado === 'falha'), true);
  await assert.rejects(rede.avaliar(b.usuario, b.req), error => error.status === 429);
});

test('configuração exige Telegram, rede e gestor dispensado; alteração revoga códigos e liberações', async t => {
  const b = await banco(t);
  await assert.rejects(rede.atualizarConfiguracao({ ativo: true, redes: [] }, b.req), /cadastre/);
  delete process.env.TELEGRAM_ACESSO_REDE_CHAT_ID;
  await assert.rejects(rede.atualizarConfiguracao({ ativo: true, redes: ['203.0.113.10'] }, b.req), /configure/);
  process.env.TELEGRAM_ACESSO_REDE_CHAT_ID = 'administracao-teste';
  await assert.rejects(rede.atualizarConfiguracao({ ativo: true, redes: ['203.0.113.10'] }, b.req), /Mantenha/);
  const { solicitacao_id } = await b.solicitar();
  b.usuario.role.nome = 'admin';
  b.usuario.permissoes = '{"configurar_acesso_rede":true}';
  await rede.atualizarConfiguracao({ ativo: true, redes: ['203.0.113.0/24'] }, b.req);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'revogado');
  await assert.rejects(b.validar(solicitacao_id), /inválida/);
  const config = await rede.buscarConfiguracao(b.req);
  assert.equal(config.ip_detectado, b.req.ip);
  assert.equal(config.telegram_configurado, true);
});

test('permissão concedida dispensa imediatamente; remoção preserva somente aprovação já existente', async t => {
  const b = await banco(t);
  const { solicitacao_id } = await b.solicitar();
  const sessao = await b.validar(solicitacao_id);
  b.usuario.permissoes = '["acesso_rede_sem_codigo"]';
  await rede.avaliarSessao(b.req, { id: 1, jti: 'outra-sessao', exp: jwt.decode(sessao.token).exp }, 'outro-token');
  b.usuario.permissoes = '[]';
  await assert.rejects(rede.avaliarSessao(b.req, { id: 1, jti: 'outra-sessao', exp: jwt.decode(sessao.token).exp }, 'outro-token'), error => error.status === 403 && error.code === 'NETWORK_ACCESS_REQUIRED');
  await rede.avaliarSessao(b.req, jwt.decode(sessao.token), sessao.token);
});

test('permite três emissões por minuto por usuário e recusa a quarta sem enviar outro código', async t => {
  const b = await banco(t);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  for (let i = 0; i < 3; i++) await b.solicitar({ id: `sessao-${i}`, exp });
  await assert.rejects(rede.avaliar(b.usuario, b.req, { id: 'sessao-4', exp }), error => error.status === 429);
  assert.equal(b.envios.length, 3);
  // Reutilizar a solicitação pendente não consome uma nova emissão.
  await b.solicitar({ id: 'sessao-0', exp });
  assert.equal(b.envios.length, 3);
});

test('permite vinte emissões por hora por usuário e cem por minuto por IP', async t => {
  const b = await banco(t);
  for (let i = 0; i < 20; i++) {
    await b.solicitar();
    const row = b.estado.acesso_rede_solicitacoes.at(-1);
    row.estado = 'bloqueado';
    row.created_at = new Date(Date.now() - (i + 2) * 60000);
  }
  await assert.rejects(rede.avaliar(b.usuario, b.req), error => error.status === 429);
  b.estado.acesso_rede_solicitacoes.splice(0);
  for (let i = 0; i < 99; i++) b.estado.acesso_rede_solicitacoes.push({
    usuario_id: i + 2, ip: b.req.ip, estado: 'pendente', created_at: new Date()
  });
  await b.solicitar();
  await assert.rejects(rede.avaliar(b.usuario, b.req, { id: 'nova-sessao', exp: Math.floor(Date.now() / 1000) + 3600 }), error => error.status === 429);
  assert.equal(b.envios.length, 21);
});

test('rotas reais bloqueiam login e upload, validam código e permitem logout mesmo com horário fechado', async t => {
  const b = await banco(t);
  b.req.ip = '127.0.0.1';
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  let uploads = 0;
  app.post('/upload', require('../src/middlewares/auth.middleware'), (_req, res) => { uploads++; res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (rota, body, token) => fetch(`${url}${rota}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const resposta = await post('/api/auth/login', { email: b.usuario.email, senha: 'Senha123' });
  assert.equal(resposta.status, 403);
  const pendente = await resposta.json();
  assert.equal(pendente.code, 'NETWORK_ACCESS_REQUIRED');
  assert.equal(pendente.token, undefined);
  const tokenInterno = jwt.sign({ id: 1, versao_sessao: 0, jti: 'sessao-interna' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await post('/upload', {}, tokenInterno)).status, 403);
  assert.equal(uploads, 0);
  const validada = await post('/api/auth/acesso-rede/validar', { solicitacao_id: pendente.solicitacao_id, codigo: b.envios[0].codigo });
  assert.equal(validada.status, 200);
  const { token } = await validada.json();
  assert.equal((await post('/upload', {}, token)).status, 200);
  assert.equal(uploads, 1);
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: false, motivo: 'SYSTEM_CLOSED' }));
  assert.equal((await post('/upload', {}, token)).status, 423);
  assert.equal((await post('/api/auth/logout', {}, token)).status, 200);
  assert.equal(b.estado.acesso_rede_solicitacoes[0].estado, 'revogado');
});

test('login e validação compartilham cem chamadas por minuto por IP e recusam a chamada seguinte', async t => {
  const app = express();
  app.set('trust proxy', ['127.0.0.1']);
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (rota, ip = '198.51.100.200') => fetch(`${url}/api/auth/${rota}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: '{}' });
  for (let i = 0; i < 100; i++) {
    const resposta = await post(i % 2 ? 'login' : 'acesso-rede/validar');
    assert.equal(resposta.status, 400);
    await resposta.json();
  }
  assert.equal((await post('login')).status, 429);
  assert.equal((await post('acesso-rede/validar')).status, 429);
  assert.equal((await post('login', '198.51.100.201')).status, 400);
});

test('migration gera schema MySQL aditivo, desativado e com permissões próprias sem lista de dispensados', async () => {
  const knex = require('knex')({ client: 'mysql2' });
  const migration = require('../src/database/migrations/20261021120000_create_acesso_rede');
  const sql = [], inseridos = [];
  const executor = tabela => ({
    where() { return this; },
    first: async () => undefined,
    insert: async dados => { inseridos.push({ tabela, dados }); }
  });
  Object.assign(executor, { schema: {
    hasTable: async () => false,
    createTable(...args) { sql.push(...knex.schema.createTable(...args).toSQL().map(row => row.sql)); }
  }, fn: knex.fn });
  try {
    await migration.up(executor);
    assert.match(sql.join('\n'), /`ativo` boolean not null default '0'/);
    assert.match(sql.join('\n'), /`codigo_hash` varchar\(64\) not null/);
    assert.match(sql.join('\n'), /on delete CASCADE/i);
    assert.equal(sql.some(row => /alter table `usuarios`/i.test(row)), false);
    assert.deepEqual(inseridos.find(row => row.tabela === 'configuracoes_acesso_rede').dados, { id: 1, ativo: false, redes: '[]' });
    assert.deepEqual(inseridos.filter(row => row.tabela === 'permissoes').map(row => row.dados.chave), ['configurar_acesso_rede', 'acesso_rede_sem_codigo']);
  } finally { await knex.destroy(); }
});

const test = require('node:test');
const acessoRede = require('../src/services/acesso-rede.service');
test.beforeEach(t => {
  t.mock.method(acessoRede, 'avaliar', async () => {});
  t.mock.method(acessoRede, 'avaliarSessao', async () => {});
});
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const Token = require('../src/models/RecuperacaoContaToken');
const recuperacao = require('../src/services/recuperacao-conta.service');
const email = require('../src/services/recuperacao-conta-email.service');
const transporte = require('../src/services/email-transporte.service');
const auditoria = require('../src/services/audit-log.service');
const auth = require('../src/services/auth.service');
const usuarios = require('../src/services/usuario.service');
const horario = require('../src/services/horario-acesso.service');
const middleware = require('../src/middlewares/auth.middleware');
const { prepararSenha, recuperarSenha } = require('../src/utils/senha-usuario');

// Banco isolado com snapshots, rollback e transações serializadas. Os testes
// verificam também os bloqueios solicitados pelo serviço, sem conexão externa.
async function banco(t) {
  let estado = { usuarios: [{ id: 1, nome: 'Ana', email: 'ana@crm.local', role_id: 2,
    role: { nome: 'usuario', permissoes: { clientes_ver: true } }, ativo: true,
    ...await prepararSenha('Atual123'), versao_sessao: 0,
    email_recuperacao: 'real@example.com', email_recuperacao_confirmado_em: '2026-10-19 00:00:00',
    email_recuperacao_pendente: null }], tokens: [] };
  let fila = Promise.resolve();
  const bloqueios = [];
  const envios = [];
  const eventos = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(Usuario, 'transaction', callback => {
    const executar = fila.then(async () => {
      const trx = { estado: structuredClone(estado) };
      const resultado = await callback(trx);
      estado = trx.estado;
      return resultado;
    });
    fila = executar.catch(() => {});
    return executar;
  });
  function query(tabela, trx) {
    const filtros = [];
    let operacao = 'buscar';
    let alteracoes;
    let unico = false;
    const builder = {
      where(campo, operador, valor) {
        if (typeof campo === 'object') {
          for (const [chave, item] of Object.entries(campo)) this.where(chave, item);
        } else if (valor === undefined) filtros.push(row => row[campo] === operador);
        else filtros.push(row => operador === '>' && new Date(row[campo]) > new Date(valor));
        return this;
      },
      whereNull(campo) { filtros.push(row => row[campo] == null); return this; },
      findById(id) { unico = true; return this.where('id', id); },
      findOne(dados) { unico = true; return this.where(dados); },
      first() { unico = true; return this; },
      forUpdate() { assert.ok(trx, 'bloqueio exige transação'); bloqueios.push(tabela); return this; },
      withGraphFetched() { return this; },
      resultSize() { operacao = 'contar'; return this; },
      patch(dados) { operacao = 'atualizar'; alteracoes = dados; return this; },
      patchAndFetchById(id, dados) { this.findById(id); return this.patch(dados); },
      insert(dados) { operacao = 'inserir'; alteracoes = dados; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const linhas = (trx ? trx.estado : estado)[tabela];
          if (operacao === 'inserir') {
            const row = { id: linhas.length + 1, ...alteracoes };
            linhas.push(row);
            return row;
          }
          const encontrados = linhas.filter(row => filtros.every(filtro => filtro(row)));
          if (operacao === 'contar') return encontrados.length;
          if (operacao === 'atualizar') encontrados.forEach(row => Object.assign(row, alteracoes));
          const copias = encontrados.map(row => tabela === 'usuarios' ? Usuario.fromJson({ ...row }) : { ...row });
          return unico ? copias[0] : copias;
        }).then(resolve, reject);
      }
    };
    return builder;
  }
  t.mock.method(Usuario, 'query', trx => query('usuarios', trx));
  t.mock.method(Token, 'query', trx => query('tokens', trx));
  t.mock.method(Permissao, 'query', () => ({ where() { return this; }, orderBy: async () => [{ chave: 'clientes_ver' }] }));
  t.mock.method(email, 'enviar', async dados => { envios.push(dados); });
  t.mock.method(auditoria, 'registrar', async (_req, evento) => { eventos.push(evento); });
  t.mock.method(auditoria, 'registrarSemBloquear', async () => {});
  t.mock.method(horario, 'avaliarAcesso', async () => ({ permitido: true, versao_sessao: estado.usuarios[0].versao_sessao }));
  return { get estado() { return estado; }, get usuario() { return estado.usuarios[0]; }, envios, eventos, bloqueios };
}

test('perfil exige senha atual; troca mantém endereço confirmado e tokens não contêm segredo', async t => {
  const b = await banco(t);
  await assert.rejects(auth.atualizarPerfil(1, { email_recuperacao: 'novo@example.com', senha_atual: 'errada' }), /Senha atual/);
  assert.equal(b.envios.length, 0);
  const perfil = await auth.atualizarPerfil(1, { email_recuperacao: ' NOVO@example.com ', senha_atual: 'Atual123' });
  assert.equal(perfil.email_recuperacao, 'real@example.com');
  assert.equal(perfil.email_recuperacao_pendente, 'novo@example.com');
  assert.equal(b.envios[0].destinatario, 'novo@example.com');
  const registro = b.estado.tokens[0];
  assert.equal(registro.token_hash, crypto.createHash('sha256').update(b.envios[0].token).digest('hex'));
  assert.equal(JSON.stringify(b.estado).includes(b.envios[0].token), false);
  assert.equal(new Date(registro.expira_em) - new Date(registro.created_at), 24 * 3600000);
  const json = Usuario.fromJson(b.usuario).toJSON();
  for (const campo of ['senha', 'senha_criptografada', 'email_recuperacao', 'email_recuperacao_pendente', 'email_recuperacao_confirmado_em', 'versao_sessao']) {
    assert.equal(campo in json, false, campo);
  }
  await assert.rejects(auth.atualizarPerfil(1, { email_recuperacao: 'inválido', senha_atual: 'Atual123' }), /e-mail válido/);
});

test('confirmação substitui endereço, invalida links antigos e só pode ser usada uma vez', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  const resetAntigo = b.envios[0].token;
  await auth.atualizarPerfil(1, { email_recuperacao: 'novo@example.com', senha_atual: 'Atual123' });
  const confirmacao = b.envios[1].token;
  await recuperacao.confirmarEmail(confirmacao);
  assert.equal(b.usuario.email_recuperacao, 'novo@example.com');
  assert.equal(b.usuario.email_recuperacao_pendente, null);
  await assert.rejects(recuperacao.confirmarEmail(confirmacao), /Link inválido/);
  await assert.rejects(recuperacao.redefinirSenha(resetAntigo, 'Nova1234'), /Link inválido/);
  assert.equal(b.usuario.versao_sessao, 0);
});

test('reenvio exige senha, invalida confirmação anterior e limita envios por finalidade', async t => {
  const b = await banco(t);
  b.usuario.email_recuperacao_pendente = 'novo@example.com';
  await assert.rejects(recuperacao.reenviarConfirmacao(1, 'errada'), /Senha atual/);
  await recuperacao.reenviarConfirmacao(1, 'Atual123');
  const anterior = b.envios[0].token;
  await recuperacao.reenviarConfirmacao(1, 'Atual123');
  await assert.rejects(recuperacao.confirmarEmail(anterior), /Link inválido/);
  await assert.rejects(recuperacao.reenviarConfirmacao(1, 'Atual123'), error => error.status === 429);
  await recuperacao.solicitar(b.usuario.email);
  assert.equal(b.envios.length, 3);
});

test('remoção exige senha, desabilita recuperação e cancela todos os links', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  await assert.rejects(auth.atualizarPerfil(1, { email_recuperacao: null }), /Senha atual/);
  await auth.atualizarPerfil(1, { email_recuperacao: null, senha_atual: 'Atual123' });
  assert.equal(b.usuario.email_recuperacao, null);
  assert.equal(b.usuario.email_recuperacao_confirmado_em, null);
  assert.ok(b.estado.tokens.every(row => row.usado_em));
  await recuperacao.solicitar(b.usuario.email);
  assert.equal(b.envios.length, 1);
});

test('solicitação usa identificador fictício, envia ao real e oculta inexistentes/inativos/sem confirmação', async t => {
  const b = await banco(t);
  const esperado = await recuperacao.solicitar(' ANA@CRM.LOCAL ');
  assert.equal(b.envios[0].destinatario, 'real@example.com');
  assert.deepEqual(await recuperacao.solicitar('ausente@crm.local'), esperado);
  b.usuario.ativo = false;
  assert.deepEqual(await recuperacao.solicitar(b.usuario.email), esperado);
  b.usuario.ativo = true;
  b.usuario.email_recuperacao_confirmado_em = null;
  assert.deepEqual(await recuperacao.solicitar(b.usuario.email), esperado);
  assert.equal(b.envios.length, 1);
  await assert.rejects(recuperacao.solicitar({ email: 'objeto' }), /e-mail válido/);
});

test('cota persistente aceita dois pedidos e suprime o terceiro sem revelar a conta', async t => {
  const b = await banco(t);
  const resultados = await Promise.all(Array.from({ length: 3 }, () => recuperacao.solicitar(b.usuario.email)));
  assert.deepEqual(resultados[0], resultados[2]);
  assert.equal(b.envios.length, 2);
  assert.equal(b.estado.tokens.length, 2);
});

test('falha SMTP faz rollback, não consome cota e não revela dados no pedido público', async t => {
  const b = await banco(t);
  email.enviar.mock.mockImplementation(async () => { throw new Error('credencial-secreta'); });
  await assert.rejects(auth.atualizarPerfil(1, {
    nome: 'Não deve persistir', email_recuperacao: 'novo@example.com', senha_atual: 'Atual123'
  }), error => error.status === 503 && !error.message.includes('credencial'));
  assert.equal(b.usuario.nome, 'Ana');
  assert.equal(b.usuario.email_recuperacao_pendente, null);
  assert.equal(b.estado.tokens.length, 0);
  assert.deepEqual(await recuperacao.solicitar(b.usuario.email), await recuperacao.solicitar('ausente@crm.local'));
  assert.equal(b.estado.tokens.length, 0);
});

test('redefinição atualiza os dois formatos, rejeita senha antiga e invalida sessões e outros links', async t => {
  const b = await banco(t);
  const sessaoAntiga = await auth.login(b.usuario.email, 'Atual123');
  assert.equal(sessaoAntiga.usuario.permissoes.clientes_ver, true);
  assert.equal('email_recuperacao' in sessaoAntiga.usuario, false);
  await recuperacao.solicitar(b.usuario.email);
  await recuperacao.solicitar(b.usuario.email);
  await recuperacao.redefinirSenha(b.envios[0].token, 'Nova1234');
  assert.equal(await bcrypt.compare('Nova1234', b.usuario.senha), true);
  assert.equal(recuperarSenha(b.usuario.senha_criptografada), 'Nova1234');
  assert.equal(b.usuario.versao_sessao, 1);
  await assert.rejects(auth.login(b.usuario.email, 'Atual123'), /inválidos/);
  await assert.rejects(recuperacao.redefinirSenha(b.envios[1].token, 'Outra1234'), /Link inválido/);
  const novaSessao = await auth.login(b.usuario.email, 'Nova1234');
  for (const [token, permitido] of [[sessaoAntiga.token, false], [jwt.sign({ id: 1 }, process.env.JWT_SECRET), false], [novaSessao.token, true]]) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    let next = false;
    await middleware({ headers: { authorization: `Bearer ${token}` } }, res, () => { next = true; });
    assert.equal(next, permitido);
    if (!permitido) assert.equal(res.code, 401);
  }
  assert.ok(b.eventos.some(evento => evento.acao === 'auth.senha_redefinida'));
  assert.equal(JSON.stringify(b.eventos).includes(b.envios[0].token), false);
});

test('sessão legada versão zero continua válida antes da recuperação e horário continua bloqueando', async t => {
  await banco(t);
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  let next = false;
  await middleware({ headers: { authorization: `Bearer ${token}` } }, res, () => { next = true; });
  assert.equal(next, true);
  horario.avaliarAcesso.mock.mockImplementation(async () => ({ permitido: false, motivo: 'SYSTEM_CLOSED', versao_sessao: 0 }));
  await assert.rejects(auth.login('ana@crm.local', 'Atual123'), error => error.code === 'SYSTEM_CLOSED');
  await middleware({ headers: { authorization: `Bearer ${token}` } }, res, () => assert.fail());
  assert.equal(res.code, 423);
});

test('links expirados, finalidade incorreta, conta inativa e senhas inválidas não alteram a conta', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  const token = b.envios[0].token;
  assert.equal(new Date(b.estado.tokens[0].expira_em) - new Date(b.estado.tokens[0].created_at), 3600000);
  for (const senha of ['curta1', 'semnumero', 'á'.repeat(36) + '1', null]) {
    await assert.rejects(recuperacao.redefinirSenha(token, senha), /senha deve/);
  }
  await assert.rejects(recuperacao.confirmarEmail(token), /Link inválido/);
  await assert.rejects(recuperacao.redefinirSenha('z'.repeat(64), 'Nova1234'), /Link inválido/);
  b.usuario.ativo = false;
  await assert.rejects(recuperacao.redefinirSenha(token, 'Nova1234'), /Link inválido/);
  b.usuario.ativo = true;
  b.estado.tokens[0].expira_em = new Date(Date.now() - 1);
  await assert.rejects(recuperacao.redefinirSenha(token, 'Nova1234'), /Link inválido/);
  assert.equal(await bcrypt.compare('Atual123', b.usuario.senha), true);
});

test('dois consumos concorrentes aceitam apenas um e solicitam bloqueios de usuário e token', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  const token = b.envios[0].token;
  const resultados = await Promise.allSettled([
    recuperacao.redefinirSenha(token, 'Primeira123'), recuperacao.redefinirSenha(token, 'Segunda123')
  ]);
  assert.equal(resultados.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(b.usuario.versao_sessao, 1);
  assert.deepEqual(b.bloqueios, ['usuarios', 'usuarios', 'tokens', 'usuarios', 'tokens']);
});

test('falha na auditoria faz rollback da senha e do consumo do token', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  auditoria.registrar.mock.mockImplementation(async () => { throw new Error('banco indisponível'); });
  await assert.rejects(recuperacao.redefinirSenha(b.envios[0].token, 'Nova1234'), /banco indisponível/);
  assert.equal(await bcrypt.compare('Atual123', b.usuario.senha), true);
  assert.equal(b.estado.tokens[0].usado_em, undefined);
  assert.equal(b.usuario.versao_sessao, 0);
});

test('trocas pelo perfil e pela administração invalidam links anteriores sem alterar demais campos', async t => {
  const b = await banco(t);
  await recuperacao.solicitar(b.usuario.email);
  await auth.atualizarPerfil(1, { senha: 'Perfil123', nome: 'Ana Nova' });
  await assert.rejects(recuperacao.redefinirSenha(b.envios[0].token, 'Nova1234'), /Link inválido/);
  assert.equal(b.usuario.nome, 'Ana Nova');
  await recuperacao.solicitar(b.usuario.email);
  await usuarios.atualizarUsuario(1, { senha: 'Admin123' });
  await assert.rejects(recuperacao.redefinirSenha(b.envios[1].token, 'Nova1234'), /Link inválido/);
  assert.equal(await bcrypt.compare('Admin123', b.usuario.senha), true);
  assert.equal(b.usuario.email_recuperacao, 'real@example.com');
});

test('transporte envia link com fragmento e rejeita configuração ausente ou destinatário recusado', async t => {
  const mensagens = [];
  const getMailer = t.mock.method(transporte, 'getTransporter', () => ({ sendMail: async dados => { mensagens.push(dados); return { accepted: [dados.to], rejected: [] }; } }));
  const original = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://crm.example.com';
  t.after(() => { if (original === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = original; });
  for (const finalidade of ['confirmacao', 'redefinicao']) await email.enviar({ destinatario: 'real@example.com', token: 'a'.repeat(64), finalidade });
  assert.match(mensagens[0].text, /confirmar-email-recuperacao#token=/);
  assert.match(mensagens[1].text, /redefinir-senha#token=/);
  assert.equal(mensagens[1].text.includes('?token='), false);
  getMailer.mock.mockImplementation(() => null);
  await assert.rejects(email.enviar({}), /SMTP/);
  getMailer.mock.mockImplementation(() => ({ sendMail: async () => ({ rejected: ['real@example.com'] }) }));
  await assert.rejects(email.enviar({ destinatario: 'real@example.com', token: 'a'.repeat(64), finalidade: 'confirmacao' }), /recusado/);
});

test('rotas públicas funcionam sem sessão, confirmação GET não consome e limitador retorna 429', async t => {
  const b = await banco(t);
  b.usuario.email_recuperacao_pendente = 'novo@example.com';
  await recuperacao.reenviarConfirmacao(1, 'Atual123');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const post = (path, body) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/confirmar-email-recuperacao?token=${b.envios[0].token}`)).status, 404);
  assert.equal(b.estado.tokens[0].usado_em, undefined);
  assert.equal((await post('reenviar-confirmacao-email-recuperacao', { senha_atual: 'Atual123' })).status, 401);
  assert.equal((await post('confirmar-email-recuperacao', { token: b.envios[0].token })).status, 200);
  assert.equal((await post('reset-password', { token: 'inválido', senha: 'Nova1234' })).status, 400);
  for (let i = 0; i < 7; i++) assert.equal((await post('forgot-password', { email: 'ausente@crm.local' })).status, 200);
  assert.equal((await post('forgot-password', { email: 'ausente@crm.local' })).status, 429);
});

test('migration adiciona campos opcionais, versão inicial zero, hash único e índices sem tocar dados existentes', async () => {
  const knex = require('knex')({ client: 'mysql2' });
  const migration = require('../src/database/migrations/20261019120000_add_recuperacao_conta');
  const sql = [];
  const executor = { schema: {
    alterTable(...args) { sql.push(...knex.schema.alterTable(...args).toSQL().map(row => row.sql)); },
    createTable(...args) { sql.push(...knex.schema.createTable(...args).toSQL().map(row => row.sql)); }
  }, fn: knex.fn };
  try {
    await migration.up(executor);
    assert.match(sql.join('\n'), /`versao_sessao` int unsigned not null default '0'/);
    assert.match(sql.join('\n'), /unique.*`token_hash`/);
    assert.match(sql.join('\n'), /on delete CASCADE/i);
    assert.equal(sql.some(row => /^(update|delete|insert)/i.test(row)), false);
  } finally { await knex.destroy(); }
});

test('timestamp SQL UTC expira corretamente mesmo quando o processo usa horário de São Paulo', async t => {
  const b = await banco(t);
  const anterior = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  t.after(() => { if (anterior === undefined) delete process.env.TZ; else process.env.TZ = anterior; });
  await recuperacao.solicitar(b.usuario.email);
  const token = b.envios[0].token;
  b.estado.tokens[0].expira_em = new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' ');
  await assert.rejects(recuperacao.redefinirSenha(token, 'Nova1234'), /Link inválido/);
  b.estado.tokens[0].expira_em = 'data inválida';
  await assert.rejects(recuperacao.redefinirSenha(token, 'Nova1234'), /Link inválido/);
  b.estado.tokens[0].expira_em = new Date(Date.now() + 60000).toISOString().slice(0, 19).replace('T', ' ');
  await recuperacao.redefinirSenha(token, 'Nova1234');
  assert.equal(b.usuario.versao_sessao, 1);
});

test('modelo envia data de confirmação ao MySQL como timestamp SQL, sem codificação JSON', () => {
  const usuario = Usuario.fromJson({ email_recuperacao_confirmado_em: '2026-10-19 12:00:00' }, { patch: true });
  assert.equal(usuario.$toDatabaseJson().email_recuperacao_confirmado_em, '2026-10-19 12:00:00');
});

test('auditoria oculta endereços reais, senha atual e valores detalhados do perfil', () => {
  const { montarAlteracoesAuditoria } = require('../src/utils/alteracoes-auditoria');
  const dados = auditoria.sanitizar({
    alteracoes: { email_recuperacao: 'real@example.com', senha_atual: 'Atual123' },
    alteracoes_detalhadas: montarAlteracoesAuditoria(
      { email_recuperacao_pendente: 'anterior@example.com' },
      { email_recuperacao_pendente: 'novo@example.com' }
    )
  });
  assert.equal(/example.com|Atual123/.test(JSON.stringify(dados)), false);
  assert.equal(dados.alteracoes_detalhadas[0].protegido, true);
});

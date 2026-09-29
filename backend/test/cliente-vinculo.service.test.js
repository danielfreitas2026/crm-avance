const test = require('node:test');
const assert = require('node:assert/strict');
const Cliente = require('../src/models/Cliente');
const ClienteOperadora = require('../src/models/ClienteOperadora');
const Usuario = require('../src/models/Usuario');
const notificacaoService = require('../src/services/notificacao.service');
const clienteService = require('../src/services/cliente.service');
const clienteController = require('../src/controllers/cliente.controller');
const clienteRoutes = require('../src/routes/cliente.routes');
const auditLogService = require('../src/services/audit-log.service');

const CNPJ = '11.222.333/0001-81';
const CPF = '529.982.247-25';

function preparar(t, clienteInicial, opcoes = {}) {
  const clientes = clienteInicial ? [{ ...clienteInicial }] : [];
  const vinculos = new Set(opcoes.vinculos || []);
  const notificacoes = [];
  let tentativasInsercao = 0;
  const usuario = {
    id: 2,
    ativo: true,
    role: { nome: 'usuario', permissoes: {} },
    permissoes: { clientes_ver_proprios: true, clientes_criar: true }
  };
  if (opcoes.verTodos) usuario.permissoes.clientes_ver_todos = true;

  class QueryCliente {
    select() { return this; }
    withGraphFetched() { return this; }
    modifyGraph() { return this; }
    orderBy() { return this; }
    limit() { return this; }
    forUpdate() { return this; }
    whereNull(coluna) { if (coluna === 'excluido_em') this.ativos = true; return this; }
    whereNot(coluna, valor) { if (coluna === 'id') this.ignorarId = valor; return this; }
    findById(id) { this.id = Number(id); return this; }
    where(coluna, valor) {
      if (typeof coluna === 'function') {
        coluna({
          where: (campo, documento) => {
            if (campo === 'cnpj_digitos') this.documento = documento;
            if (campo === 'criado_por_id') this.usuarioEscopo = Number(documento);
            return { orWhereRaw() {}, orWhereExists() {} };
          },
          orWhereExists() { return this; }
        });
      } else if (coluna === 'criado_por_id') this.usuarioEscopo = Number(valor);
      else if (coluna === 'id') this.id = Number(valor);
      return this;
    }
    resultado() {
      return clientes.filter(cliente =>
        (this.id === undefined || cliente.id === this.id) &&
        (!this.documento || cliente.cnpj_digitos === this.documento) &&
        (!this.ignorarId || cliente.id !== this.ignorarId) &&
        (!this.ativos || !cliente.excluido_em) &&
        (this.usuarioEscopo === undefined || cliente.criado_por_id === this.usuarioEscopo || vinculos.has(`${cliente.id}:${this.usuarioEscopo}`))
      );
    }
    first() { return Promise.resolve(this.resultado()[0]); }
    then(resolve, reject) { return Promise.resolve(this.id === undefined ? this.resultado() : this.resultado()[0]).then(resolve, reject); }
    async insertAndFetch(dados) {
      tentativasInsercao += 1;
      if (opcoes.colisao && tentativasInsercao === 1) {
        clientes.push({ id: 7, nome: 'Original', cnpj: dados.cnpj, cnpj_digitos: dados.cnpj_digitos, criado_por_id: 1, excluido_em: null });
        throw Object.assign(new Error('duplicated document'), { code: 'ER_DUP_ENTRY' });
      }
      if (clientes.some(cliente => cliente.cnpj_digitos === dados.cnpj_digitos)) {
        throw Object.assign(new Error('duplicated document'), { code: 'ER_DUP_ENTRY' });
      }
      const criado = { ...dados, id: 7, excluido_em: null };
      clientes.push(criado);
      return criado;
    }
    async patchAndFetchById(id, dados) {
      const cliente = clientes.find(item => item.id === Number(id));
      Object.assign(cliente, dados);
      return cliente;
    }
  }

  function tabela(nome) {
    const consulta = {
      filtro: {},
      where(campo, valor) {
        if (typeof campo === 'object') Object.assign(this.filtro, campo);
        else this.filtro[campo] = valor;
        return this;
      },
      first() {
        const chave = `${this.filtro.cliente_id}:${this.filtro.usuario_id}`;
        return Promise.resolve(vinculos.has(chave) ? { cliente_id: this.filtro.cliente_id } : undefined);
      },
      update(dados) {
        const cliente = clientes.find(item => item.id === Number(this.filtro.id));
        Object.assign(cliente, dados);
        return Promise.resolve(1);
      },
      insert(dados) { this.dados = dados; return this; },
      onConflict() { return this; },
      ignore() { return this.executar(); },
      executar() {
        if (nome === 'cliente_consultoras') {
          for (const dado of [].concat(this.dados)) vinculos.add(`${dado.cliente_id}:${dado.usuario_id}`);
        }
        return Promise.resolve();
      },
      then(resolve, reject) { return this.executar().then(resolve, reject); }
    };
    return consulta;
  }
  tabela.select = () => ({ from: () => ({ whereRaw: () => ({ where: () => ({}) }) }) });
  tabela.raw = () => 1;

  t.mock.method(Cliente, 'query', () => new QueryCliente());
  t.mock.method(Cliente, 'transaction', callback => callback(tabela));
  t.mock.method(Cliente, 'knex', () => tabela);
  t.mock.method(ClienteOperadora, 'query', () => ({
    delete() { return this; },
    where() { return this; },
    withGraphFetched() { return this; },
    orderBy() { return this; },
    then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); }
  }));
  t.mock.method(Usuario, 'query', () => ({ findById: () => ({ withGraphFetched: async () => usuario }) }));
  t.mock.method(notificacaoService, 'sincronizarFidelidadeCliente', async id => { notificacoes.push(id); });
  return { clientes, vinculos, notificacoes, get tentativasInsercao() { return tentativasInsercao; } };
}

for (const documento of [CNPJ, CPF]) {
  test(`oculta ${documento} alheio e vincula sem alterar os dados`, async t => {
    const original = { id: 7, nome: 'Original', cnpj: documento, cnpj_digitos: documento.replace(/\D/g, ''), criado_por_id: 1, excluido_em: null };
    const estado = preparar(t, original);
    assert.equal((await clienteService.verificarDocumentoCliente(documento, { usuarioId: 2 })).existe, false);
    assert.ok(!await clienteService.buscarClientePorId(7, 2));
    assert.deepEqual(await clienteService.listarClientesSelect({}, 2), []);

    const resultado = await clienteService.criarCliente({ nome: 'Novo nome', cnpj: documento, responsavel_tipo: 'invalido', consultora_ids: ['invalido'] }, 2);
    assert.equal(resultado.acao, 'vinculado');
    assert.equal(resultado.cliente.id, 7);
    assert.equal(resultado.cliente.nome, 'Original');
    assert.equal(estado.clientes.length, 1);
    assert.equal(estado.clientes[0].nome, 'Original');
    assert.equal(estado.vinculos.has('7:2'), true);
    assert.equal((await clienteService.verificarDocumentoCliente(documento, { usuarioId: 2 })).existe, true);
    assert.equal((await clienteService.buscarClientePorId(7, 2)).id, 7);
    assert.equal((await clienteService.listarClientesSelect({}, 2))[0].id, 7);
    assert.deepEqual(estado.notificacoes, []);
  });
}

test('restaura cliente alheio na lixeira e preserva o cadastro', async t => {
  const estado = preparar(t, { id: 7, nome: 'Original', cnpj: CNPJ, cnpj_digitos: CNPJ.replace(/\D/g, ''), criado_por_id: 1, excluido_em: '2026-09-01', excluir_definitivo_em: '2026-10-01', excluido_por_id: 1 });
  assert.equal((await clienteService.verificarDocumentoCliente(CNPJ, { usuarioId: 2 })).existe, false);
  const resultado = await clienteService.criarCliente({ nome: 'Outro nome', cnpj: CNPJ }, 2);
  assert.equal(resultado.acao, 'restaurado');
  assert.equal(resultado.cliente.nome, 'Original');
  assert.equal(estado.clientes[0].excluido_em, null);
  assert.equal(estado.clientes[0].excluido_por_id, null);
  assert.equal(estado.vinculos.has('7:2'), true);
  assert.deepEqual(estado.notificacoes, [7]);
});

test('duplicidade visivel continua bloqueada, inclusive na lixeira', async t => {
  preparar(t, { id: 7, nome: 'Original', cnpj: CNPJ, cnpj_digitos: CNPJ.replace(/\D/g, ''), criado_por_id: 2, excluido_em: '2026-09-01' });
  assert.equal((await clienteService.verificarDocumentoCliente(CNPJ, { usuarioId: 2 })).cliente.excluido, true);
  await assert.rejects(clienteService.criarCliente({ nome: 'Outro', cnpj: CNPJ }, 2), /Ja existe um cliente/);
});

test('cliente ja vinculado a consultora continua sendo duplicidade visivel', async t => {
  preparar(t, { id: 7, nome: 'Original', cnpj: CNPJ, cnpj_digitos: CNPJ.replace(/\D/g, ''), criado_por_id: 1, excluido_em: null }, { vinculos: ['7:2'] });
  assert.equal((await clienteService.verificarDocumentoCliente(CNPJ, { usuarioId: 2 })).existe, true);
  await assert.rejects(clienteService.criarCliente({ nome: 'Outro', cnpj: CNPJ }, 2), /Ja existe um cliente/);
});

test('colisao de cadastro concorrente reutiliza o registro criado por outra usuaria', async t => {
  const estado = preparar(t, null, { colisao: true });
  const resultado = await clienteService.criarCliente({ nome: 'Tentativa', cnpj: CNPJ }, 2);
  assert.equal(resultado.acao, 'vinculado');
  assert.equal(resultado.cliente.nome, 'Original');
  assert.equal(estado.tentativasInsercao, 1);
  assert.equal(estado.clientes.length, 1);
  assert.equal(estado.vinculos.has('7:2'), true);
});

test('documento novo cria cliente sem vínculo adicional', async t => {
  const estado = preparar(t, null);
  const resultado = await clienteService.criarCliente({ nome: 'Novo', cnpj: CNPJ }, 2);
  assert.equal(resultado.acao, 'criado');
  assert.equal(resultado.cliente.nome, 'Novo');
  assert.equal(estado.clientes.length, 1);
  assert.equal(estado.clientes[0].criado_por_id, 2);
  assert.deepEqual(estado.notificacoes, [7]);
});

test('permissao de ver todos preserva verificacao e bloqueio de duplicidade', async t => {
  preparar(t, { id: 7, nome: 'Original', cnpj: CNPJ, cnpj_digitos: CNPJ.replace(/\D/g, ''), criado_por_id: 1, excluido_em: null }, { verTodos: true });
  assert.equal((await clienteService.verificarDocumentoCliente(CNPJ, { usuarioId: 2 })).existe, true);
  await assert.rejects(clienteService.criarCliente({ nome: 'Outro', cnpj: CNPJ }, 2), /Ja existe um cliente/);
});

test('controller passa identidade da usuaria para a verificacao de documento', async t => {
  let opcoes;
  t.mock.method(clienteService, 'verificarDocumentoCliente', async (_documento, recebidas) => {
    opcoes = recebidas;
    return { existe: false };
  });
  const resposta = { json(body) { this.body = body; return this; } };
  await clienteController.verificarDocumento({ params: { documento: CNPJ }, query: {}, usuario: { id: 2 } }, resposta);
  assert.equal(opcoes.usuarioId, 2);
  assert.deepEqual(resposta.body, { existe: false });
});

for (const [acao, evento] of [
  ['criado', 'cliente.criado'],
  ['vinculado', 'cliente.consultora_vinculada'],
  ['restaurado', 'cliente.restaurado']
]) {
  test(`POST responde 201 e audita cadastro ${acao}`, async t => {
    const registros = [];
    t.mock.method(clienteService, 'criarCliente', async () => ({ cliente: { id: 7, nome: 'Original' }, acao }));
    t.mock.method(auditLogService, 'registrarSemBloquear', async (_req, dados) => { registros.push(dados); });
    const rota = clienteRoutes.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route;
    const auditar = rota.stack[1].handle;
    const req = { body: { nome: 'Nome inventado', cnpj: CNPJ }, usuario: { id: 2 } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      send(body) { this.body = body; return this; }
    };
    auditar(req, res, () => {});
    await clienteController.store(req, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 7, nome: 'Original' });
    assert.equal(registros[0].acao, evento);
    if (acao !== 'criado') assert.deepEqual(registros[0].dados, { cliente_id: 7, usuario_id: 2, restaurado: acao === 'restaurado' });
  });
}

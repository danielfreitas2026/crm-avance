const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const localService = require('../src/services/lead-local.service');
const planilhaService = require('../src/services/lead-planilha.service');
const { prepararConfig, escolherColuna, interrompida, processarLote, processar } = localService._internals;

test.after(() => db.destroy());

function planilha() {
  return { id: 1, status: 'concluida', colunas: ['Terminal', 'Fixo', 'Local'], schema_colunas: {}, local_config: null };
}

test('preserva colunas importadas e reutiliza somente a coluna de sua configuração', () => {
  assert.equal(escolherColuna(['Terminal'], null), 'Local');
  assert.equal(escolherColuna(['local', 'Local por DDD', 'Local por DDD (2)'], null), 'Local por DDD (3)');
  const config = prepararConfig(planilha(), ['Terminal', 'Fixo', 'Terminal'], { total: 2, limite_id: 5 });
  assert.deepEqual(config.campos, ['Terminal', 'Fixo']);
  assert.equal(config.coluna, 'Local por DDD');
  assert.equal(config.status, 'processando');
  assert.equal(config.total, 2);
  assert.equal(config.limite_id, 5);
  const anterior = { ...config, status: 'concluido' };
  const repetida = prepararConfig({ ...planilha(), local_config: anterior }, ['Fixo'], { total: 2 });
  assert.equal(repetida.coluna, anterior.coluna);
  assert.notEqual(repetida.execucao_id, anterior.execucao_id);
  assert.equal(repetida.processadas, 0);
});

test('valida origem, importação e execução concorrente antes de iniciar', () => {
  for (const campos of [null, [], 'Terminal', ['Inexistente'], ['Fixo (atualizado)'], [12]]) {
    assert.throws(() => prepararConfig(planilha(), campos, {}), { statusCode: 400 });
  }
  assert.throws(() => prepararConfig({ ...planilha(), status: 'processando' }, ['Terminal'], {}), { statusCode: 409 });
  const config = prepararConfig(planilha(), ['Terminal'], { total: 1 });
  assert.throws(() => prepararConfig({ ...planilha(), local_config: config }, ['Fixo'], {}), { statusCode: 409 });
  assert.throws(() => prepararConfig({ ...planilha(), colunas: [...planilha().colunas, config.coluna], local_config: { ...config, status: 'concluido' } }, [config.coluna], {}), { statusCode: 400 });
  const velha = { ...config, atualizado_em: new Date(Date.now() - 301000).toISOString() };
  assert.equal(interrompida(velha), true);
  assert.equal(interrompida({ ...velha, status: 'concluido' }), false);
  assert.doesNotThrow(() => prepararConfig({ ...planilha(), local_config: velha }, ['Fixo'], {}));
});

// Banco em memória limitado às operações do worker; nenhuma conexão é aberta.
function bancoWorker(t, linhas, { falhar = false } = {}) {
  let atual = { ...planilha(), local_config: prepararConfig(planilha(), ['Terminal', 'Fixo'], { total: linhas.length, limite_id: linhas.at(-1)?.id || 0 }) };
  let registros = structuredClone(linhas);
  const eventos = [];
  let fila = Promise.resolve();
  t.mock.method(db, 'transaction', callback => {
    const executar = async () => {
      const copia = structuredClone({ atual, registros });
      const trx = tabela => {
        const condicoes = [];
        let limite = Infinity;
        let contar = false;
        const matches = registro => condicoes.every(([campo, op, valor]) => op === '>' ? registro[campo] > valor : op === '<=' ? registro[campo] <= valor : registro[campo] == valor);
        const query = {
          where(campo, op, valor) { condicoes.push([campo, valor === undefined ? '=' : op, valor === undefined ? op : valor]); return this; },
          forUpdate() { eventos.push(`lock:${tabela}`); return this; },
          first() {
            if (contar) {
              const filtradas = registros.filter(matches);
              return Promise.resolve({ total: filtradas.length, limite_id: filtradas.at(-1)?.id || 0 });
            }
            return Promise.resolve(tabela === 'lead_planilhas' && matches(atual) ? structuredClone(atual) : null);
          },
          count() { contar = true; return this; },
          max() { return this; },
          orderBy() { return this; },
          limit(valor) { limite = valor; return this; },
          select() { return Promise.resolve(structuredClone(registros.filter(matches).slice(0, limite))); },
          async update(patch) {
            if (tabela === 'lead_planilhas') { atual = { ...atual, ...patch, local_config: JSON.parse(patch.local_config) }; return 1; }
            if (falhar) throw new Error('erro simulado');
            registros = registros.map(registro => {
              if (!matches(registro)) return registro;
              const [, [caminho, texto]] = patch.dados_json;
              const coluna = JSON.parse(caminho.slice(2));
              return { ...registro, dados_json: { ...registro.dados_json, [coluna]: texto }, local_ddds: JSON.parse(patch.local_ddds) };
            });
            return 1;
          }
        };
        return query;
      };
      trx.raw = (sql, bindings) => [sql, bindings];
      try { return await callback(trx); }
      catch (error) { atual = copia.atual; registros = copia.registros; throw error; }
    };
    const resultado = fila.then(executar);
    fila = resultado.catch(() => {});
    return resultado;
  });
  return { get atual() { return atual; }, get linhas() { return registros; }, eventos,
    mudarConfig(config) { atual.local_config = config; } };
}

test('worker percorre lotes por ID, preserva dados e desfechos e conclui sem duplicações', async t => {
  const linhas = Array.from({ length: 501 }, (_, i) => ({
    id: i + 1, planilha_id: 1, dados_json: { Terminal: '1932345678', Fixo: i ? '21999998888' : '', Local: 'Original' },
    atribuido_para_id: 7, status_operacional: 'vendido', venda_id: 88
  }));
  const banco = bancoWorker(t, linhas);
  const id = banco.atual.local_config.execucao_id;
  assert.equal(await processarLote(1, id), true);
  assert.equal(banco.atual.local_config.processadas, 500);
  assert.equal(banco.linhas[500].local_ddds, undefined);
  await processar(1, id);
  assert.equal(banco.atual.local_config.status, 'concluido');
  assert.equal(banco.atual.local_config.processadas, 501);
  assert.equal(banco.atual.local_config.identificadas, 501);
  assert.deepEqual(banco.linhas[1].local_ddds, ['19', '21']);
  for (const linha of banco.linhas) {
    assert.equal(linha.dados_json.Local, 'Original');
    assert.equal(linha.atribuido_para_id, 7);
    assert.equal(linha.venda_id, 88);
    assert.equal(linha.status_operacional, 'vendido');
    assert.ok(linha.dados_json['Local por DDD']);
  }
  assert.deepEqual(banco.eventos.slice(0, 2), ['lock:lead_planilhas', 'lock:lead_linhas']);
  const copia = structuredClone(banco.linhas);
  assert.equal(await processarLote(1, id), false);
  assert.deepEqual(banco.linhas, copia);
});

test('worker antigo não escreve sobre nova execução e concorrentes não repetem linhas', async t => {
  const banco = bancoWorker(t, [{ id: 1, planilha_id: 1, dados_json: { Terminal: '123' } }]);
  assert.equal(await processarLote(1, 'execucao-antiga'), false);
  const id = banco.atual.local_config.execucao_id;
  await Promise.all([processarLote(1, id), processarLote(1, id)]);
  assert.equal(banco.atual.local_config.processadas, 1);
  assert.equal(banco.atual.local_config.identificadas, 0);
  assert.deepEqual(banco.linhas[0].local_ddds, []);
  assert.equal(banco.linhas[0].dados_json['Local por DDD'], 'Não identificado');
});

test('início persiste configuração e coluna, impede dois pedidos e executa em segundo plano', async t => {
  const banco = bancoWorker(t, [{ id: 1, planilha_id: 1, dados_json: { Terminal: '1932345678', Local: 'Importado' } }]);
  banco.mudarConfig(null);
  const pedidos = await Promise.allSettled([localService.iniciar(1, ['Terminal']), localService.iniciar(1, ['Fixo'])]);
  assert.equal(pedidos[0].status, 'fulfilled');
  assert.equal(pedidos[1].reason.statusCode, 409);
  assert.equal(pedidos[0].value.local_config.status, 'processando');
  assert.deepEqual(pedidos[0].value.local_config.campos, ['Terminal']);
  assert.deepEqual(pedidos[0].value.colunas, ['Terminal', 'Fixo', 'Local', 'Local por DDD']);
  for (let tentativa = 0; tentativa < 10 && banco.atual.local_config.status === 'processando'; tentativa++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(banco.atual.local_config.status, 'concluido');
  assert.equal(banco.linhas[0].dados_json.Local, 'Importado');
  assert.match(banco.linhas[0].dados_json['Local por DDD'], /DDD 19/);
});

test('erro reverte o lote e sinaliza resultados parciais; execução interrompida permite repetir', async t => {
  const banco = bancoWorker(t, [{ id: 1, planilha_id: 1, dados_json: { Terminal: '1932345678' } }], { falhar: true });
  await processar(1, banco.atual.local_config.execucao_id);
  assert.equal(banco.atual.local_config.status, 'erro');
  assert.equal(banco.atual.local_config.processadas, 0);
  assert.equal(banco.linhas[0].local_ddds, undefined);
  assert.match(banco.atual.local_config.erro, /parciais/);
  banco.mudarConfig({ ...banco.atual.local_config, status: 'processando', atualizado_em: '2000-01-01T00:00:00Z' });
  const reconciliada = await localService.reconciliar(banco.atual);
  assert.equal(reconciliada.local_config.status, 'erro');
  assert.match(reconciliada.local_config.erro, /interrompido/);
});

test('filtro combina DDDs e não identificados com OR, demais critérios com AND', () => {
  const query = db('lead_linhas').where('planilha_id', 7);
  localService.aplicarFiltro(query, { local_ddds: '19,21,19', local_nao_identificado: 'true' });
  const sql = query.toSQL();
  assert.match(sql.sql, /planilha_id.*and \(JSON_CONTAINS.* or JSON_CONTAINS.* or JSON_LENGTH/s);
  assert.deepEqual(sql.bindings, [7, '"19"', '"21"']);
  assert.throws(() => localService.normalizarFiltro({ local_ddds: ['19', '20'] }), { statusCode: 400 });
  assert.throws(() => localService.normalizarFiltro({ local_ddds: {} }), { statusCode: 400 });
  assert.throws(() => localService.normalizarFiltro({ local_ddds: [''] }), { statusCode: 400 });
  assert.equal(localService.normalizarFiltro({ local_ddds: [] }).ativo, false);
});

test('listagem, CSV e divisão bloqueiam região incompleta antes de consultar ou alterar linhas', async t => {
  const consultas = [];
  t.mock.method(db.client, 'runner', builder => ({ run: async () => { consultas.push(builder.toSQL()); return { id: 1 }; } }));
  const filtros = { planilha_ids: [1], local_ddds: ['19'] };
  await assert.rejects(planilhaService.listarLinhas(filtros), { statusCode: 409 });
  await assert.rejects(planilhaService.exportarCsv(filtros, {}), { statusCode: 409 });
  await assert.rejects(planilhaService.dividirLeads({ nome: 'Envio', usuario_ids: [7], quantidade_total: 1, filtros }, 9), { statusCode: 409 });
  assert.equal(consultas.length, 3);
  for (const consulta of consultas) {
    assert.match(consulta.sql, /local_config/);
    assert.match(consulta.sql, /`id` in/);
    assert.doesNotMatch(consulta.sql, /select.*lead_linhas/);
    assert.ok(consulta.bindings.includes('concluido'));
  }
});

test('rotas de catálogo e preenchimento exigem gerenciar_leads', async t => {
  const router = require('../src/routes/lead-planilha.routes');
  const Usuario = require('../src/models/Usuario');
  let permissoes = {};
  t.mock.method(Usuario, 'query', () => ({
    findById() { return this; },
    async withGraphFetched() { return { id: 9, ativo: true, role: { nome: 'usuario', permissoes: {} }, permissoes }; }
  }));
  for (const [path, method] of [['/locais', 'get'], ['/:id/local', 'post']]) {
    const rota = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    for (const permitido of [false, true]) {
      permissoes = permitido ? { gerenciar_leads: true } : {};
      let avancou = false;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
      await rota.stack[0].handle({ usuario: { id: 9 } }, res, () => { avancou = true; });
      assert.equal(avancou, permitido);
      assert.equal(res.statusCode, permitido ? 200 : 403);
    }
  }
});

test('controller retorna 202 ao iniciar e mantém erros de validação como 400/409', async t => {
  const controller = require('../src/controllers/lead-planilha.controller');
  const chamadas = [];
  t.mock.method(localService, 'iniciar', async (id, campos) => {
    chamadas.push({ id, campos });
    if (!campos) throw Object.assign(new Error('Selecione campos.'), { statusCode: 400 });
    return { id, local_config: { status: 'processando' } };
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.preencherLocal({ params: { id: '1' }, body: { campos: ['Terminal'] } }, res);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(chamadas[0], { id: '1', campos: ['Terminal'] });
  await controller.preencherLocal({ params: { id: '1' }, body: {} }, res);
  assert.equal(res.statusCode, 400);
  controller.locais({}, res);
  assert.equal(res.body.length, 67);
});

test('Excel individual inclui Local gerado e mantém Local importado', async t => {
  const ExcelJS = require('exceljs');
  const LeadPlanilha = require('../src/models/LeadPlanilha');
  const LeadLinha = require('../src/models/LeadLinha');
  t.mock.method(LeadPlanilha, 'query', () => ({ findById: async () => ({ ...planilha(), colunas: ['Terminal', 'Local', 'Local por DDD'] }) }));
  let offset = 0;
  const query = {
    where() { return this; }, orderBy() { return this; }, offset(valor) { offset = valor; return this; },
    async limit() { return offset ? [] : [{ dados_json: { Terminal: '1932345678', Local: 'Importado', 'Local por DDD': 'Campinas e região/SP — DDD 19' } }]; }
  };
  t.mock.method(LeadLinha, 'query', () => query);
  const buffer = await planilhaService.gerarPlanilhaXlsx(1);
  const workbook = await new ExcelJS.Workbook().xlsx.load(buffer);
  const aba = workbook.worksheets[0];
  assert.equal(aba.getCell('B1').text, 'Local');
  assert.equal(aba.getCell('B2').text, 'Importado');
  assert.equal(aba.getCell('C1').text, 'Local por DDD');
  assert.equal(aba.getCell('C2').text, 'Campinas e região/SP — DDD 19');
});

test('migration pode continuar após aplicação parcial e rollback preserva dados_json', async () => {
  const migration = require('../src/database/migrations/20261020120000_add_local_ddd_mailing');
  const existentes = new Set(['lead_planilhas.local_config']);
  const alteracoes = [];
  const knex = { schema: {
    async hasColumn(tabela, coluna) { return existentes.has(`${tabela}.${coluna}`); },
    async alterTable(tabela, callback) {
      callback({
        json(coluna) { existentes.add(`${tabela}.${coluna}`); alteracoes.push(`add:${tabela}.${coluna}`); return { nullable() {} }; },
        dropColumn(coluna) { existentes.delete(`${tabela}.${coluna}`); alteracoes.push(`drop:${tabela}.${coluna}`); }
      });
    }
  } };
  await migration.up(knex);
  await migration.up(knex);
  assert.deepEqual(alteracoes, ['add:lead_linhas.local_ddds']);
  await migration.down(knex);
  assert.deepEqual(alteracoes.slice(1), ['drop:lead_linhas.local_ddds', 'drop:lead_planilhas.local_config']);
  assert.equal(existentes.size, 0);
});

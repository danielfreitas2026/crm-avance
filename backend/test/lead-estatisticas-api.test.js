const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../src/services/lead-estatisticas.service');

test('APIs de resumo, mailings, clientes e Excel compartilham o mesmo conjunto de eventos', async t => {
  const knex = require('knex')({ client: 'mysql2' });
  const connectionPath = require.resolve('../src/database/connection');
  require(connectionPath);
  const cache = require.cache[connectionPath];
  const original = cache.exports;
  const consultas = [];
  const fontes = {
    'lead_linhas': [{ id: 1, dados_json: '{"Empresa":"Loja antiga"}' }],
    'audit_logs as a': [{ id: 1, entidade_id: '1', acao: 'lead_linha.chamada_nao_atendida',
      usuario_id: 9, usuario_nome: 'Administradora', created_at: '2025-02-10T12:00:00Z' }],
    'lead_telegram_publicacoes as p': [{ id: 1, lead_linha_id: 1, tipo: 'legado',
      telegram_chat_id: 'grupo-teste', telegram_message_id: '100',
      atribuicao_sondagem_id: 10, publicado_em: '2025-02-10T13:00:00Z' }],
    'vendas as v': [], 'lead_venda_vinculos_manuais': []
  };
  cache.exports = tabela => {
    const query = knex(tabela);
    query.then = (resolve, reject) => {
      const sql = query.toSQL();
      consultas.push(sql);
      let dados = fontes[tabela] || [];
      if (tabela === 'lead_atribuicoes as la') {
        dados = sql.sql.startsWith('select distinct') ? [{ lead_linha_id: 1 }]
          : sql.bindings.includes('venda') ? [] : [{
            id: 10, lead_linha_id: 1, etapa: 'sondagem', usuario_id: 7, usuario_nome: 'Qualificadora',
            envio_id: 100, envio_nome: 'Mailing antigo', atribuido_em: '2025-01-10T12:00:00Z'
          }];
      }
      return Promise.resolve(dados).then(resolve, reject);
    };
    return query;
  };
  t.after(async () => { cache.exports = original; await knex.destroy(); });
  const periodo = { data_inicio: '2025-02-10', data_fim: '2025-02-10' };
  const resumo = await stats.obterEstatisticasResumo(periodo);
  assert.equal(resumo.total.clientes_movimentados, 1);
  assert.equal(resumo.total.total_acoes, 2);
  assert.equal(resumo.total.novos_envios_telegram, 0);
  assert.equal(resumo.total.clientes_enviados_telegram, 1);
  assert.equal(resumo.usuarios[0].usuario_id, 7);
  assert.equal(resumo.usuarios[0].clientes_enviados_telegram, 1);
  const mailings = await stats.obterEstatisticasMailings({ ...periodo, usuario_id: 7 });
  assert.equal(mailings.resumo.total_acoes, resumo.total.total_acoes);
  assert.equal(mailings.data[0].envio_id, 100);
  assert.equal(mailings.resumo.clientes_enviados_telegram, 1);
  assert.equal(mailings.data[0].clientes_enviados_telegram, 1);
  const linhas = await stats.obterEstatisticasLinhas({ ...periodo, usuario_id: 7, envio_id: 100, page_size: 1 });
  assert.equal(linhas.total, 1);
  assert.equal(linhas.page_size, 1);
  assert.equal(linhas.resumo.total_acoes, 2);
  assert.equal(linhas.resumo.clientes_enviados_telegram, 1);
  assert.equal(linhas.data[0].movimentacoes_periodo[1].envio_telegram_confirmado, true);
  assert.equal(linhas.data[0].movimentacoes_periodo.length, 2);
  const arquivo = await stats.gerarXlsxEstatisticasFuturosClientes({ ...periodo, usuario_id: 7, envio_id: 100 });
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(arquivo.buffer);
  assert.equal(workbook.getWorksheet('Resumo').getCell('C1').value, 'Clientes enviados ao Telegram');
  assert.equal(workbook.getWorksheet('Resumo').getCell('C2').value, 1);
  assert.equal(workbook.getWorksheet('Resumo').getCell('E2').value, 2);
  assert.equal(workbook.getWorksheet('Movimentações').rowCount, 3);
  assert.match(arquivo.nome, /2025-02-10-a-2025-02-10/);
  assert.ok(consultas.some(item => item.bindings.includes(7)));
  assert.ok(consultas.some(item => item.bindings.includes(100)));
  assert.ok(!consultas.some(item => item.sql.includes('atribuido_em') && item.sql.includes('between')));
  const vazio = await stats.obterEstatisticasResumo({ data_inicio: '2025-03-01', data_fim: '2025-03-01' });
  assert.equal(vazio.total.clientes_movimentados, 0);
  assert.equal(vazio.total.clientes_enviados_telegram, 0);
  assert.deepEqual(vazio.usuarios, []);
});

test('todos os controllers de estatísticas devolvem 400 para período invertido', async t => {
  const controller = require('../src/controllers/lead-planilha.controller');
  t.mock.method(console, 'error', () => {});
  for (const nome of ['estatisticasResumo', 'estatisticasMailings', 'estatisticasLinhas', 'exportarMetricasFuturosClientes']) {
    const resposta = {
      statusCode: 200, status(valor) { this.statusCode = valor; return this; },
      json(valor) { this.body = valor; return this; }
    };
    await controller[nome]({ query: { data_inicio: '2025-03-01', data_fim: '2025-02-01' },
      params: { usuarioId: '7', envioId: '100' } }, resposta);
    assert.equal(resposta.statusCode, 400, nome);
    assert.match(resposta.body.message, /data inicial/);
  }
});

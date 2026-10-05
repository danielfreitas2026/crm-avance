const test = require('node:test');
const assert = require('node:assert/strict');
const Venda = require('../src/models/Venda');
const Usuario = require('../src/models/Usuario');
const Permissao = require('../src/models/Permissao');
const FunilEtapa = require('../src/models/FunilEtapa');
const vendaService = require('../src/services/venda.service');
const dashboard = require('../src/services/dashboard-integracao.service');
const { montarAlteracoesAuditoria } = require('../src/utils/alteracoes-auditoria');

test('edição de venda audita valores persistidos, data e autor sem depender do formulário inteiro', async () => {
  const original = { venda: Venda.query, usuario: Usuario.query, permissao: Permissao.query, etapa: FunilEtapa.query, transaction: Venda.transaction, dashboard: dashboard.sincronizarVendaAtualizada };
  let estado = { id: 42, nome: 'Original', data_venda: '2026-08-27', venda_antiga: false, valor_total: 100, status_funil: 'aprovacao', vendedora_id: 7, updated_at: '2026-08-27 12:00:00' };
  const eventos = [];
  const trx = tabela => ({ where() { return this; }, async pluck() { assert.equal(tabela, 'venda_vendedoras'); return [7]; } });
  Permissao.query = () => ({ where() { return this; }, async select() { return []; } });
  Usuario.query = () => ({ findById() { return this; }, async withGraphFetched() { return { id: 7, ativo: true, permissoes: { vendas_alterar_data: true }, role: { nome: 'admin' } }; } });
  FunilEtapa.query = () => ({ where() { return this; }, orderBy() { return this; }, async first() { return { codigo: 'concluido' }; } });
  Venda.transaction = async callback => { const resultado = await callback(trx); eventos.push('commit'); return resultado; };
  Venda.query = transaction => ({
    findById() { return this; }, withGraphFetched() { return this; }, modifyGraph() { return this; },
    then(resolve, reject) { return Promise.resolve({ ...estado, vendedoras: [{ id: 7 }] }).then(resolve, reject); },
    async forUpdate() {
      assert.equal(transaction, trx); eventos.push('lock');
      // Outra edição terminou entre a leitura inicial e a aquisição do bloqueio.
      estado = { ...estado, nome: 'Concorrente' };
      return { ...estado };
    },
    async patchAndFetchById(_id, patch) {
      assert.equal(transaction, trx); eventos.push('update');
      estado = { ...estado, ...patch }; return { ...estado };
    }
  });
  dashboard.sincronizarVendaAtualizada = async id => { assert.equal(id, 42); eventos.push('dashboard'); return { status: 'enviada' }; };
  try {
    const diferencas = [];
    const resultado = await vendaService.atualizarVenda(42, { nome: ' Novo ', data_venda: '2026-10-01', valor_total: 150, campo_desconhecido: 'não persistido' }, 7, {
      registrarAuditoria: async (antes, depois, transaction) => {
        assert.equal(transaction, trx); eventos.push('audit');
        diferencas.push(...montarAlteracoesAuditoria(antes, depois));
      }
    });
    assert.equal(resultado.nome, 'Novo');
    // O total enviado diretamente é ignorado pelo serviço: não deve virar alteração.
    assert.equal(resultado.valor_total, 100);
    assert.deepEqual(eventos, ['lock', 'update', 'audit', 'commit', 'dashboard']);
    assert.deepEqual(diferencas, [
      { campo: 'nome', anterior: 'Concorrente', novo: 'Novo' },
      { campo: 'data_venda', anterior: '2026-08-27', novo: '2026-10-01' }
    ]);
  } finally {
    Venda.query = original.venda; Usuario.query = original.usuario; FunilEtapa.query = original.etapa;
    Permissao.query = original.permissao;
    Venda.transaction = original.transaction; dashboard.sincronizarVendaAtualizada = original.dashboard;
  }
});

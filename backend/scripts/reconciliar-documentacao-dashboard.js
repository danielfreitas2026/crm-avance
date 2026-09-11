const db = require('../src/database/connection');
const dashboardIntegracaoService = require('../src/services/dashboard-integracao.service');

const aplicar = process.argv.includes('--apply');

async function executar() {
  const candidatos = await dashboardIntegracaoService.listarCandidatosReconciliacaoDocumentacao();
  const totalLancamentos = candidatos.reduce((total, item) => total + Number(item.total_lancamentos || 0), 0);

  console.log(JSON.stringify({
    modo: aplicar ? 'aplicar' : 'diagnostico',
    vendas_candidatas: candidatos.length,
    lancamentos_candidatos: totalLancamentos,
    vendas: candidatos.map(item => Number(item.venda_id))
  }, null, 2));

  if (!aplicar) {
    console.log('Diagnostico concluido. Execute novamente com --apply para atualizar via PUT.');
    return;
  }

  const totais = { vendas: candidatos.length, atualizados: 0, ignorados: 0, erros: 0 };
  for (const candidato of candidatos) {
    try {
      const resultado = await dashboardIntegracaoService.sincronizarDocumentacaoAtualizada(candidato.venda_id);
      totais.atualizados += resultado.atualizados;
      totais.ignorados += resultado.ignorados;
      totais.erros += resultado.erros;
    } catch (error) {
      totais.erros += Number(candidato.total_lancamentos || 1);
      console.error(`Venda ${candidato.venda_id}: ${error.message}`);
    }
  }

  console.log(JSON.stringify(totais, null, 2));
  if (totais.erros > 0) process.exitCode = 1;
}

executar()
  .catch(error => {
    console.error('Falha na reconciliacao de documentacao do dashboard:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());

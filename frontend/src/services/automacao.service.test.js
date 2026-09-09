import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet, apiPost } from './api';
import { corrigirHistoricoAutomacao, listarAutomacoes, listarInconsistenciasHistoricoAutomacoes, listarProblemasAutomaticos, listarVendasCandidatasAutomacao, obterPreviaCorrecaoHistoricoAutomacao, obterVendaProblemaAutomatico, resolverProblemaAutomatico } from './automacao.service';

describe('automacao.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia status e paginação ao listar problemas', async () => {
    await listarProblemasAutomaticos({ status: 'resolvidos', page: 3, perPage: 50 });
    expect(apiGet).toHaveBeenCalledWith('/problemas?status=resolvidos&page=3&per_page=50');
  });

  it('usa os endpoints contextual da venda e de resolução', async () => {
    await obterVendaProblemaAutomatico(7);
    await resolverProblemaAutomatico(7, 'Cadastro corrigido.');
    expect(apiGet).toHaveBeenCalledWith('/problemas/7/venda');
    expect(apiPost).toHaveBeenCalledWith('/problemas/7/resolver', { mensagem: 'Cadastro corrigido.' });
  });

  it('busca vendas candidatas da automação com CNPJ opcional', async () => {
    await listarVendasCandidatasAutomacao(10);
    await listarVendasCandidatasAutomacao(10, '17.025.544/0007-04');

    expect(apiGet).toHaveBeenNthCalledWith(1, '/automacoes/10/vendas-candidatas');
    expect(apiGet).toHaveBeenNthCalledWith(2, '/automacoes/10/vendas-candidatas?cnpj=17025544000704');
  });

  it('envia classificacao de cancelamento na listagem de automacoes', async () => {
    await listarAutomacoes({ classificacao: 'cancelamento', page: 2, perPage: 50 });

    expect(apiGet).toHaveBeenCalledWith('/automacoes?page=2&per_page=50&classificacao=cancelamento');
  });

  it('usa os endpoints de auditoria e correção de histórico', async () => {
    await listarInconsistenciasHistoricoAutomacoes();
    await obterPreviaCorrecaoHistoricoAutomacao(70);
    await corrigirHistoricoAutomacao(70, { motivo: 'Vínculo incorreto' });
    expect(apiGet).toHaveBeenNthCalledWith(1, '/automacoes/inconsistencias-historico');
    expect(apiGet).toHaveBeenNthCalledWith(2, '/automacoes/inconsistencias-historico/70');
    expect(apiPost).toHaveBeenCalledWith('/automacoes/inconsistencias-historico/70/corrigir', { motivo: 'Vínculo incorreto' });
  });
});

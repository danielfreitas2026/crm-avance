import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet, apiPost } from './api';
import { coletarHistoricoAutomacoes, corrigirHistoricoAutomacao, diagnosticarImapClaro, listarAutomacoes, listarInconsistenciasHistoricoAutomacoes, listarProblemasAutomaticos, listarVendasCandidatasAutomacao, obterPreviaCorrecaoHistoricoAutomacao, obterVendaProblemaAutomatico, repetirInvalidosClaro, resolverProblemaAutomatico } from './automacao.service';

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

  it('envia o titulo normalizado e codificado na listagem de automacoes', async () => {
    await listarAutomacoes({ status: 'concluido', titulo: '  Análise & aceite  ' });

    expect(apiGet).toHaveBeenCalledWith('/automacoes?page=1&per_page=20&status=concluido&titulo=An%C3%A1lise+%26+aceite');
  });

  it('filtra por operadora e seleciona a origem da coleta histórica', async () => {
    await listarAutomacoes({ operadora: 'Claro' });
    await coletarHistoricoAutomacoes('imap_claro');
    expect(apiGet).toHaveBeenCalledWith('/automacoes?page=1&per_page=20&operadora=Claro');
    expect(apiPost).toHaveBeenCalledWith('/automacoes/coletar-historico', { origem: 'imap_claro' });
  });

  it('executa o diagnóstico IMAP no backend autenticado', async () => {
    await diagnosticarImapClaro();
    expect(apiPost).toHaveBeenCalledWith('/automacoes/diagnostico-imap', {});
  });

  it('aciona o reprocessamento seletivo da Claro', async () => {
    await repetirInvalidosClaro();
    expect(apiPost).toHaveBeenCalledWith('/automacoes/repetir-invalidos-claro', {});
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

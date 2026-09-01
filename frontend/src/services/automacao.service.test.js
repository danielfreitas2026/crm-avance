import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

import { apiGet, apiPost } from './api';
import { listarProblemasAutomaticos, obterVendaProblemaAutomatico, resolverProblemaAutomatico } from './automacao.service';

describe('automacao.service - problemas', () => {
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
});

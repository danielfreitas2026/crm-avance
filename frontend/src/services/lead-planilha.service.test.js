import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiBlob: vi.fn(),
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn()
}));

import { apiDelete, apiGet, apiPost } from './api';
import {
  adminDesvincularVendaLead,
  adminVincularVendaLead,
  listarVendasCandidatasLead
} from './lead-planilha.service';

describe('vinculo administrativo de venda com futuro cliente', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa exclusivamente os endpoints administrativos', async () => {
    await listarVendasCandidatasLead(12);
    await adminVincularVendaLead(12, 45);
    await adminDesvincularVendaLead(12);

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/linhas/12/vendas-candidatas');
    expect(apiPost).toHaveBeenCalledWith('/lead-planilhas/linhas/12/venda', { venda_id: 45 });
    expect(apiDelete).toHaveBeenCalledWith('/lead-planilhas/linhas/12/venda');
  });
});

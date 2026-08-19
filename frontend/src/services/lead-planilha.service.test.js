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
  enviarFuturoClienteParaDistribuicao,
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

  it('envia o CNPJ alternativo na busca e na confirmacao do vinculo', async () => {
    await listarVendasCandidatasLead(12, '12.345.678/0001-90');
    await adminVincularVendaLead(12, 45, '12345678000190');

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/linhas/12/vendas-candidatas?cnpj=12.345.678%2F0001-90');
    expect(apiPost).toHaveBeenCalledWith('/lead-planilhas/linhas/12/venda', {
      venda_id: 45,
      cnpj: '12345678000190'
    });
  });
});

describe('distribuicao de futuro cliente reservado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa o endpoint da carteira do usuario', async () => {
    await enviarFuturoClienteParaDistribuicao(81);

    expect(apiPost).toHaveBeenCalledWith('/lead-planilhas/me/futuros-clientes/81/distribuir', {});
  });
});

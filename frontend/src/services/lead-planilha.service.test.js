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
  excluirFuturoCliente,
  excluirFuturoClienteDefinitivo,
  listarFuturosClientesLixeira,
  listarFuturosClientesComConsultoras,
  listarResponsaveisFuturosClientes,
  obterHistoricoFuturoCliente,
  listarVendasCandidatasLead,
  restaurarFuturoCliente
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

  it('consulta o historico comercial no endpoint protegido da visao Todos', async () => {
    await obterHistoricoFuturoCliente(81);

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/futuros-clientes/81/historico');
  });
});

describe('lixeira de futuros clientes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('usa os endpoints restritos a carteira propria por padrao', async () => {
    await listarFuturosClientesLixeira({ page: 2 });
    await excluirFuturoCliente(81);
    await restaurarFuturoCliente(81);
    await excluirFuturoClienteDefinitivo(81);

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/me/futuros-clientes/lixeira?page=2');
    expect(apiDelete).toHaveBeenNthCalledWith(1, '/lead-planilhas/me/futuros-clientes/81');
    expect(apiPost).toHaveBeenCalledWith('/lead-planilhas/me/futuros-clientes/81/restaurar', {});
    expect(apiDelete).toHaveBeenNthCalledWith(2, '/lead-planilhas/me/futuros-clientes/81/definitivo');
  });

  it('usa os endpoints protegidos da visao Todos quando solicitado', async () => {
    await listarFuturosClientesLixeira({}, true);
    await excluirFuturoCliente(81, true);
    await restaurarFuturoCliente(81, true);
    await excluirFuturoClienteDefinitivo(81, true);

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/futuros-clientes/lixeira');
    expect(apiDelete).toHaveBeenNthCalledWith(1, '/lead-planilhas/futuros-clientes/81');
    expect(apiPost).toHaveBeenCalledWith('/lead-planilhas/futuros-clientes/81/restaurar', {});
    expect(apiDelete).toHaveBeenNthCalledWith(2, '/lead-planilhas/futuros-clientes/81/definitivo');
  });
});

describe('filtros de futuros clientes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('consulta as opcoes de responsavel no escopo Todos', async () => {
    await listarResponsaveisFuturosClientes();

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/futuros-clientes/responsaveis');
  });

  it('consulta o acompanhamento de consultoras com busca e paginacao', async () => {
    await listarFuturosClientesComConsultoras({ page: 2, page_size: 30, busca: 'Ana Souza' });

    expect(apiGet).toHaveBeenCalledWith('/lead-planilhas/futuros-clientes/em-acompanhamento?page=2&page_size=30&busca=Ana+Souza');
  });
});

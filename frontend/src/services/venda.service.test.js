import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiBlob: vi.fn(),
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiRequest: vi.fn(),
}));

import { apiDelete, apiGet, apiPost, apiPut, apiRequest } from './api';
import {
  atualizarAceiteBiometriaVenda,
  atualizarStatusVenda,
  atualizarVenda,
  buscarVendaPorId,
  criarVenda,
  deletarVenda,
  excluirReversaoVenda,
  gerarEmailVenda,
  listarAprovacoesVenda,
  listarVendas,
  listarVendasLixeira,
  marcarProblemaVenda,
  registrarReversaoVenda,
  restaurarVenda,
  urlVisualizarArquivoVenda,
} from './venda.service';

describe('venda.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('monta query de vendas preservando filtros repetidos e ignorando vazios', async () => {
    await listarVendas({ status: 'aprovacao', vazio: '', pagina: 2 });
    await listarVendasLixeira({ busca: 'cliente' });
    await listarAprovacoesVenda({ status: 'pendente' });

    expect(apiGet).toHaveBeenNthCalledWith(1, '/vendas?status=aprovacao&pagina=2');
    expect(apiGet).toHaveBeenNthCalledWith(2, '/vendas/lixeira?busca=cliente');
    expect(apiGet).toHaveBeenNthCalledWith(3, '/vendas/aprovacoes?status=pendente');
  });

  it('usa endpoints principais de venda', async () => {
    await buscarVendaPorId(5);
    await criarVenda({ nome: 'Venda' });
    await atualizarVenda(5, { nome: 'Atualizada' });
    await deletarVenda(5);
    await restaurarVenda(5);
    await gerarEmailVenda(5);
    await marcarProblemaVenda(5, { motivo: 'Documento' });

    expect(apiGet).toHaveBeenCalledWith('/vendas/5');
    expect(apiPost).toHaveBeenNthCalledWith(1, '/vendas', { nome: 'Venda' });
    expect(apiPut).toHaveBeenCalledWith('/vendas/5', { nome: 'Atualizada' });
    expect(apiDelete).toHaveBeenCalledWith('/vendas/5');
    expect(apiPost).toHaveBeenNthCalledWith(2, '/vendas/5/restaurar', {});
    expect(apiPost).toHaveBeenNthCalledWith(3, '/vendas/5/email-template', {});
    expect(apiPost).toHaveBeenNthCalledWith(4, '/vendas/5/problemas', { motivo: 'Documento' });
  });

  it('atualiza status via PATCH com body serializado', async () => {
    await atualizarStatusVenda(7, { status_funil: 'ativacao' });

    expect(apiRequest).toHaveBeenCalledWith('/vendas/7/status', {
      method: 'PATCH',
      body: JSON.stringify({ status_funil: 'ativacao' }),
    });
  });

  it('registra reversao em endpoint separado da edicao comum', async () => {
    await registrarReversaoVenda(7, { nome: 'Corrigido' }, 'Correção solicitada', '2026-08-13T12:00:00.000Z');

    expect(apiPost).toHaveBeenCalledWith('/vendas/7/reversoes', {
      venda: { nome: 'Corrigido' },
      observacao: 'Correção solicitada',
      versao: '2026-08-13T12:00:00.000Z'
    });
  });

  it('atualiza marcador de aceite ou biometria via PATCH', async () => {
    await atualizarAceiteBiometriaVenda(7, 'biometria', true);

    expect(apiRequest).toHaveBeenCalledWith('/vendas/7/aceite-biometria', {
      method: 'PATCH',
      body: JSON.stringify({ marcador: 'biometria', concluido: true }),
    });
  });

  it('exclui reversao com motivo em endpoint separado', async () => {
    await excluirReversaoVenda(7, 21, 'Registro duplicado');

    expect(apiDelete).toHaveBeenCalledWith('/vendas/7/reversoes/21', {
      motivo: 'Registro duplicado'
    });
  });

  it('monta URL de visualizacao de arquivo com base padrao da API', () => {
    expect(urlVisualizarArquivoVenda(9, 12)).toBe('http://localhost:3000/api/vendas/9/arquivos/12/view');
  });
});

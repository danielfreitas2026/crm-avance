import { describe, expect, it } from 'vitest';
import {
  aplicarVendaAntigaAoFormulario,
  criarEstadoDataVenda,
  normalizarIndicadorVendaAntiga,
  obterDataVendaPayload
} from './venda-data';

describe('VendaModal - data da venda', () => {
  it('inicia uma venda comum sem data manual', () => {
    const venda = criarEstadoDataVenda();

    expect(venda.venda_antiga).toBe(false);
    expect(venda.data_venda).toBe('');
  });

  it('limpa a data manual ao desmarcar venda antiga', () => {
    const venda = aplicarVendaAntigaAoFormulario({
      venda_antiga: true,
      data_venda: '2026-08-01'
    }, false);

    expect(venda).toMatchObject({ venda_antiga: false, data_venda: '' });
  });

  it('preserva a data ao desmarcar venda antiga durante a edição', () => {
    const venda = aplicarVendaAntigaAoFormulario({
      venda_antiga: true,
      data_venda: '2026-08-01'
    }, false, true);

    expect(venda).toMatchObject({ venda_antiga: false, data_venda: '2026-08-01' });
  });

  it('normaliza a classificação recebida da API', () => {
    expect(normalizarIndicadorVendaAntiga(1)).toBe(true);
    expect(normalizarIndicadorVendaAntiga(false)).toBe(false);
  });

  it('envia a data escolhida na edição e mantém o cadastro comum automático', () => {
    expect(obterDataVendaPayload({
      editando: true,
      vendaAntiga: false,
      dataVenda: '2035-12-31'
    })).toBe('2035-12-31');
    expect(obterDataVendaPayload({
      editando: false,
      vendaAntiga: false,
      dataVenda: '2035-12-31'
    })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  aplicarVendaAntigaAoFormulario,
  criarEstadoDataVenda,
  normalizarIndicadorVendaAntiga
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

  it('normaliza a classificação recebida da API', () => {
    expect(normalizarIndicadorVendaAntiga(1)).toBe(true);
    expect(normalizarIndicadorVendaAntiga(false)).toBe(false);
  });
});

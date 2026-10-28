import { describe, expect, it } from 'vitest';
import { filtrarVendedorasVisiveis } from './venda-vendedoras';

describe('filtrarVendedorasVisiveis', () => {
  it('descarta vendedoras que nao aparecem no seletor da venda', () => {
    expect(filtrarVendedorasVisiveis([12, 9], [{ id: 9, nome: 'Consultora' }])).toEqual([9]);
  });

  it('mantem todas as vendedoras visiveis em venda compartilhada', () => {
    expect(filtrarVendedorasVisiveis([9, 10], [{ id: '9' }, { id: 10 }])).toEqual([9, 10]);
  });

  it('nao filtra enquanto as opcoes ainda nao foram carregadas', () => {
    expect(filtrarVendedorasVisiveis([9], [])).toEqual([9]);
  });
});

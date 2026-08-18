import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

import VendaModal from './VendaModal';

describe('VendaModal - consulta automática de CNPJ', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mantém o preenchimento manual sem consultar serviços externos', () => {
    render(
      <VendaModal
        clientes={[]}
        vendedoras={[]}
        operadoras={[]}
        tiposVenda={[]}
        servicos={[]}
        vendasPorCliente={new Map()}
        usuarioLogado={{ id: 1, permissoes: {} }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('00.000.000/0000-00'), {
      target: { value: '12.345.678/0001-95' }
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /buscar dados/i })).not.toBeInTheDocument();
  });
});

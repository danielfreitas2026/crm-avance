import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn(() => new Promise(() => {}))
}));

vi.mock('./VendaProblemaPanel', () => ({
  default: () => <div>Fluxo de problemas isolado</div>
}));

import VendaModal from './VendaModal';

const venda = {
  id: 7,
  nome: 'Cliente Teste',
  cliente_id: 3,
  vendedora_id: 9,
  vendedoras: [{ id: 9, nome: 'Consultora' }],
  venda_antiga: false,
  data_venda: '2026-09-17'
};

function renderModal(permissoes = {}) {
  return render(
    <VendaModal
      venda={venda}
      clientes={[{ id: 3, nome: 'Cliente Teste' }]}
      vendedoras={[{ id: 9, nome: 'Consultora' }]}
      operadoras={[]}
      tiposVenda={[]}
      servicos={[]}
      vendasPorCliente={new Map()}
      usuarioLogado={{
        id: 9,
        ativo: true,
        role: { nome: 'usuario', permissoes: {} },
        permissoes: { vendas_editar: true, ...permissoes }
      }}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

describe('VendaModal - permissão para alterar data', () => {
  it('mostra a data existente bloqueada para usuário sem permissão', () => {
    renderModal();

    expect(screen.getByLabelText(/Data da venda/i)).toHaveValue('2026-09-17');
    expect(screen.getByLabelText(/Data da venda/i)).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Venda antiga/i })).toBeDisabled();
  });

  it('libera qualquer data e a preserva ao alternar a classificação', () => {
    renderModal({ vendas_alterar_data: true });

    const data = screen.getByLabelText(/Data da venda/i);
    const vendaAntiga = screen.getByRole('checkbox', { name: /Venda antiga/i });
    expect(data).toBeEnabled();
    expect(data).toHaveAttribute('min', '1900-01-01');
    expect(data).not.toHaveAttribute('max');

    fireEvent.change(data, { target: { value: '2035-12-31' } });
    fireEvent.click(vendaAntiga);
    fireEvent.click(vendaAntiga);

    expect(data).toHaveValue('2035-12-31');
  });
});

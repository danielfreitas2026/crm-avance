import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

import VendaModal from './VendaModal';

const usuario = {
  id: 9,
  ativo: true,
  role: { nome: 'usuario', permissoes: {} },
  permissoes: {
    vendas_ver_todas: true,
    vendas_permitir_reversoes: true
  }
};

function renderModal(overrides = {}) {
  return render(
    <VendaModal
      venda={{
        id: 7,
        nome: 'Cliente corrigido',
        cliente_id: 3,
        vendedora_id: 9,
        vendedoras: [{ id: 9, nome: 'Consultora' }],
        updated_at: '2026-08-13 12:00:00',
        reversoes: [{
          id: 21,
          numero: 1,
          observacao: 'Correção solicitada pelo cliente.',
          created_at: '2026-08-13 12:00:00',
          usuario: { id: 9, nome: 'Consultora' },
          alteracoes: [{ campo: 'nome', anterior: 'Cliente antigo', novo: 'Cliente corrigido' }]
        }],
        campos_com_reversao: ['nome']
      }}
      clientes={[{ id: 3, nome: 'Cliente corrigido' }]}
      vendedoras={[{ id: 9, nome: 'Consultora' }]}
      operadoras={[]}
      tiposVenda={[]}
      servicos={[]}
      vendasPorCliente={new Map()}
      usuarioLogado={usuario}
      podeRegistrarReversao
      modoEdicao={false}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onSaveReversal={vi.fn()}
      {...overrides}
    />
  );
}

describe('VendaModal - reversões', () => {
  it('mostra a trilha existente e libera o modo de reversão pelo botão amarelo', async () => {
    renderModal();

    expect(screen.getByText('Reversão 1')).toBeInTheDocument();
    expect(screen.getByText('Correção solicitada pelo cliente.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Registrar Reversão/i }));

    expect(await screen.findByLabelText(/Nova observação de reversão/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar reversão/i })).toBeInTheDocument();
  });

  it('abre o histórico permanente ao lado de campo alterado', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Ver histórico de Nome/i }));

    await waitFor(() => expect(screen.getByText('Valor anterior')).toBeInTheDocument());
    expect(screen.getByText('Cliente antigo')).toBeInTheDocument();
    expect(screen.getAllByText('Cliente corrigido').length).toBeGreaterThan(0);
  });
});

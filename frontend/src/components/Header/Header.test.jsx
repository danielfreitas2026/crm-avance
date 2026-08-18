import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', () => ({
  listarLinksExternos: vi.fn().mockResolvedValue([])
}));

import Header from './Header';

describe('Header', () => {
  it('encaminha o alerta ao clicar no X do modal de notificacoes', async () => {
    const user = userEvent.setup();
    const alerta = {
      id: 7,
      tipo: 'lead_retorno_due',
      titulo: 'Retorno pendente',
      mensagem: 'Atenda o cliente.'
    };
    const onExcluirAlerta = vi.fn();

    render(
      <Header
        title="Dashboard"
        alertasUrgentes={[alerta]}
        onExcluirAlerta={onExcluirAlerta}
      />
    );

    await user.click(screen.getByRole('button', { name: /1 aviso pendente/i }));
    await user.click(screen.getByRole('button', { name: 'Excluir notificação' }));

    expect(onExcluirAlerta).toHaveBeenCalledWith(alerta);
  });

  it('exibe mais de cinco alertas no modal da navbar', async () => {
    const user = userEvent.setup();
    const alertas = Array.from({ length: 6 }, (_, indice) => ({
      id: indice + 1,
      tipo: 'cliente_fidelidade',
      titulo: `Alerta ${indice + 1}`,
      mensagem: `Mensagem ${indice + 1}`
    }));

    render(<Header title="Dashboard" alertasUrgentes={alertas} />);

    await user.click(screen.getByRole('button', { name: /6 avisos pendentes/i }));

    expect(screen.getAllByRole('button', { name: 'Excluir notificação' })).toHaveLength(6);
    expect(screen.getByText('Alerta 6')).toBeInTheDocument();
  });
});

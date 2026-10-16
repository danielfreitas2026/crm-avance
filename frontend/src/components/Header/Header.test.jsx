import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', () => ({
  listarLinksExternos: vi.fn().mockResolvedValue([])
}));

import Header from './Header';

describe('Header', () => {
  const alertasComData = [
    { id: 1, tipo: 'venda_cancelada', titulo: 'Venda cancelada', mensagem: 'Empresa São José', created_at: '2026-10-16T12:00:00Z' },
    { id: 2, tipo: 'lead_retorno_due', titulo: 'Retorno de lead vencido', mensagem: 'Ligação agendada', created_at: '2026-10-15T12:00:00Z' }
  ];

  it('combina filtros, mantém o total no sino e preserva critérios ao reabrir', async () => {
    const user = userEvent.setup();
    render(<Header title="Dashboard" alertasUrgentes={alertasComData} />);
    const sino = screen.getByRole('button', { name: /2 avisos pendentes/i });
    await user.click(sino);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar notificações' }), 'sao jose');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'venda_cancelada');
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-16' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-16' } });
    expect(screen.getByText('1 de 2 avisos')).toBeInTheDocument();
    expect(screen.getByText('Empresa São José')).toBeInTheDocument();
    expect(screen.queryByText('Ligação agendada')).not.toBeInTheDocument();
    expect(sino).toHaveTextContent('2 avisos pendentes');
    await user.click(sino);
    await user.click(sino);
    expect(screen.getByRole('searchbox')).toHaveValue('sao jose');
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-16');
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getAllByRole('button', { name: 'Excluir notificação' })).toHaveLength(2);
  });

  it('fecha por Escape devolvendo o foco ao sino e encaminha a abertura filtrada', async () => {
    const user = userEvent.setup();
    const abrir = vi.fn();
    render(<Header title="Dashboard" alertasUrgentes={alertasComData} onAbrirAlerta={abrir} />);
    const sino = screen.getByRole('button', { name: /2 avisos pendentes/i });
    await user.click(sino);
    await user.type(screen.getByRole('searchbox'), 'sao jose');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sino).toHaveFocus();
    await user.click(sino);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(abrir).toHaveBeenCalledWith(alertasComData[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marca todos mesmo com zero resultados e exibe erros de período e envio', async () => {
    const user = userEvent.setup();
    const marcar = vi.fn();
    const { rerender } = render(<Header title="Dashboard" alertasUrgentes={alertasComData} onMarcarTodasLidas={marcar} />);
    await user.click(screen.getByRole('button', { name: /2 avisos pendentes/i }));
    await user.type(screen.getByRole('searchbox'), 'inexistente');
    expect(screen.getByText(/Nenhuma notificação encontrada/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(marcar).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-17' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-16' } });
    expect(screen.getByRole('alert')).toHaveTextContent('A data inicial');
    expect(screen.getByLabelText('Até')).toHaveAttribute('aria-invalid', 'true');
    rerender(<Header title="Dashboard" alertasUrgentes={alertasComData} onMarcarTodasLidas={marcar} marcandoTodasLidas />);
    expect(screen.getByRole('button', { name: 'Marcando…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Marcando…' }));
    expect(marcar).toHaveBeenCalledTimes(1);
    rerender(<Header title="Dashboard" alertasUrgentes={[]} onMarcarTodasLidas={marcar} erroMarcarTodasLidas="Falha no envio" />);
    expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toBeDisabled();
    expect(screen.getByText('Nenhuma notificação ativa.')).toBeInTheDocument();
    expect(screen.getByText('Falha no envio')).toHaveAttribute('role', 'alert');
  });

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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', () => ({
  listarLinksExternos: vi.fn().mockResolvedValue([])
}));

import Header from './Header';

describe('Header', () => {
  it('apresenta o estado vazio e identifica o painel de avisos', async () => {
    const user = userEvent.setup();
    render(<Header title="Dashboard" />);

    await user.click(screen.getByRole('button', { name: /0 avisos pendentes/i }));

    const painel = screen.getByRole('region', { name: 'Avisos pendentes' });
    expect(painel).toHaveTextContent('0 avisos');
    expect(painel).toHaveTextContent('Tudo em dia!');
    expect(painel).toHaveTextContent('Nenhuma notificação ativa.');
    expect(screen.queryByRole('button', { name: 'Excluir notificação' })).not.toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole('region', { name: 'Avisos pendentes' })).not.toBeInTheDocument();
  });

  it.each([
    ['lead_retorno_due', 'leads', 'Atender agora'],
    ['cliente_fidelidade', 'clientes', 'Abrir cliente'],
    ['venda_problema_aberto', 'vendas', 'Abrir'],
  ])('preserva a abertura do aviso %s e fecha o painel', async (tipo, entidade, acao) => {
    const user = userEvent.setup();
    const alerta = { id: 7, tipo, entidade, titulo: 'Aviso pendente', mensagem: 'Confira os detalhes.' };
    const onAbrirAlerta = vi.fn();
    render(<Header title="Dashboard" alertasUrgentes={[alerta]} onAbrirAlerta={onAbrirAlerta} />);

    await user.click(screen.getByRole('button', { name: /1 aviso pendente/i }));
    expect(screen.queryByText('Tudo em dia!')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: acao }));

    expect(onAbrirAlerta).toHaveBeenCalledWith(alerta);
    expect(screen.queryByRole('region', { name: 'Avisos pendentes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Confira os detalhes.')).not.toBeInTheDocument();
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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FuturosClientesPage from './FuturosClientesPage';
import {
  listarFuturosClientesLeads,
  listarQuadroFuturosClientes,
  listarResponsaveisFuturosClientes
} from '../../services/lead-planilha.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <main>{children}</main>
}));

vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 1, nome: 'Admin' }),
  temPermissao: (_usuario, permissao) => permissao === 'futuros_clientes_ver_todos'
}));

vi.mock('../../services/lead-planilha.service', async () => {
  const actual = await vi.importActual('../../services/lead-planilha.service');
  return {
    ...actual,
    listarFuturosClientesLeads: vi.fn(),
    listarQuadroFuturosClientes: vi.fn(),
    listarResponsaveisFuturosClientes: vi.fn()
  };
});

describe('busca de futuros clientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarFuturosClientesLeads.mockResolvedValue({ data: [], total: 0 });
    listarQuadroFuturosClientes.mockResolvedValue({ data: [], total: 0 });
    listarResponsaveisFuturosClientes.mockResolvedValue([]);
  });

  it('mantem o foco no campo ao digitar mais de uma letra no escopo Todos', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/futuros-clientes']}>
        <FuturosClientesPage />
      </MemoryRouter>
    );

    const botaoTodos = screen.getByRole('button', { name: 'Todos' });
    await user.click(botaoTodos);

    const campoBusca = screen.getByPlaceholderText('Buscar futuros clientes...');
    await user.click(campoBusca);
    await user.type(campoBusca, 'RPXasD');

    await waitFor(() => expect(listarQuadroFuturosClientes).toHaveBeenLastCalledWith(
      expect.objectContaining({ busca: 'RPXasD' })
    ));
    expect(campoBusca).toHaveValue('RPXasD');
    expect(campoBusca).toHaveFocus();
    expect(botaoTodos).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Futuros Clientes Recebidos' })).not.toHaveFocus();
  });

  it('filtra o quadro pelo responsavel atual, destino e periodo de marcacao', async () => {
    listarResponsaveisFuturosClientes.mockResolvedValue([
      { id: 7, nome: 'Ana Consultora', ativo: true }
    ]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/futuros-clientes']}>
        <FuturosClientesPage />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Todos' }));
    await user.click(screen.getByRole('button', { name: /Mais filtros/ }));
    await user.selectOptions(await screen.findByLabelText('Filtrar pelo usuário responsável atual'), '7');
    await user.selectOptions(screen.getByLabelText('Filtrar destino dos futuros clientes'), 'distribuicao');
    await user.type(screen.getByText('Marcado a partir de').parentElement.querySelector('input'), '2026-08-01');
    await user.type(screen.getByText('Marcado até').parentElement.querySelector('input'), '2026-08-20');

    await waitFor(() => expect(listarQuadroFuturosClientes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        responsavel_id: '7',
        destino: 'distribuicao',
        marcado_de: '2026-08-01',
        marcado_ate: '2026-08-20'
      })
    ));
    expect(screen.getByRole('button', { name: 'Mais filtros (4)' })).toBeVisible();
  });
});

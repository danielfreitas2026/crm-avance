import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FuturosClientesPage from './FuturosClientesPage';
import {
  listarFuturosClientesLeads,
  listarQuadroFuturosClientes
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
    listarQuadroFuturosClientes: vi.fn()
  };
});

describe('busca de futuros clientes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarFuturosClientesLeads.mockResolvedValue({ data: [], total: 0 });
    listarQuadroFuturosClientes.mockResolvedValue({ data: [], total: 0 });
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

    expect(campoBusca).toHaveValue('RPXasD');
    expect(campoBusca).toHaveFocus();
    expect(botaoTodos).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Futuros Clientes Recebidos' })).not.toHaveFocus();
  });
});

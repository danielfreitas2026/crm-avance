import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuturosClientesPage from './FuturosClientesPage';
import { formatarTempoRetornoConsultora } from './lead-status';
import { listarFuturosClientesComConsultoras } from '../../services/lead-planilha.service';

const authState = vi.hoisted(() => ({ gerente: true }));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <main>{children}</main>
}));

vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 1, nome: 'Gestor' }),
  temPermissao: (_usuario, permissao) => permissao === 'futuros_clientes_ver_todos' && authState.gerente
}));

vi.mock('../../services/lead-planilha.service', async () => {
  const actual = await vi.importActual('../../services/lead-planilha.service');
  return {
    ...actual,
    listarFuturosClientesLeads: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    listarFuturosClientesComConsultoras: vi.fn()
  };
});

describe('aba de futuros clientes com consultoras', () => {
  beforeEach(() => {
    authState.gerente = true;
    vi.clearAllMocks();
    listarFuturosClientesComConsultoras.mockResolvedValue({
      data: [{
        id: 12,
        razao_social: 'Empresa Exemplo Ltda',
        cnpj: '00123456000199',
        consultora: { id: 7, nome: 'Ana Consultora' },
        situacao: 'retorno_marcado',
        retorno_previsto_em: '2020-01-01T00:00:00.000Z'
      }],
      total: 1,
      page: 1,
      page_size: 30
    });
  });

  afterEach(() => cleanup());

  it('fica visivel apenas para gestores', () => {
    const { unmount } = render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Com consultoras' })).toBeVisible();
    unmount();

    authState.gerente = false;
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Com consultoras' })).not.toBeInTheDocument();
  });

  it('mostra dados, prazo vencido e pesquisa no endpoint paginado', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Com consultoras' }));

    expect(await screen.findByText('Empresa Exemplo Ltda')).toBeVisible();
    expect(screen.getByText('00.123.456/0001-99')).toBeVisible();
    expect(screen.getByText('Ana Consultora')).toBeVisible();
    expect(screen.getByText('Retorno marcado')).toBeVisible();
    expect(screen.getByText('Prazo vencido')).toBeVisible();

    await user.type(screen.getByRole('textbox', { name: 'Buscar futuros clientes com consultoras' }), 'Ana');
    await waitFor(() => expect(listarFuturosClientesComConsultoras).toHaveBeenLastCalledWith({
      page: 1,
      page_size: 30,
      busca: 'Ana'
    }));
  });

  it('formata a contagem regressiva sem exibir valores negativos', () => {
    const agora = new Date('2026-08-21T12:00:00.000Z').getTime();
    expect(formatarTempoRetornoConsultora('2026-08-21T13:05:00.000Z', agora)).toBe('1h 5min');
    expect(formatarTempoRetornoConsultora('2026-08-21T11:59:59.000Z', agora)).toBe('Prazo vencido');
    expect(formatarTempoRetornoConsultora(null, agora)).toBe('-');
  });
});

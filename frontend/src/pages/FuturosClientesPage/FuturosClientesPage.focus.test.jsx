import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('restaura a aba e mantém buscas independentes nos escopos Meus e Todos', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    const user = userEvent.setup();
    const view = () => <MemoryRouter initialEntries={['/futuros-clientes']}><FuturosClientesPage /></MemoryRouter>;
    const first = render(view());
    await user.type(screen.getByPlaceholderText('Buscar futuros clientes...'), 'Minha carteira');
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    expect(screen.getByPlaceholderText('Buscar futuros clientes...')).toHaveValue('');
    await user.type(screen.getByPlaceholderText('Buscar futuros clientes...'), 'Equipe inteira');
    first.unmount();
    render(view());
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('Buscar futuros clientes...')).toHaveValue('Equipe inteira');
    await user.click(screen.getByRole('button', { name: 'Meus', exact: true }));
    expect(screen.getByPlaceholderText('Buscar futuros clientes...')).toHaveValue('Minha carteira');
  });

  it('um link explícito seleciona a aba recebida, mesmo com outra aba salva', () => {
    localStorage.setItem('usuario', '{"id":1}');
    sessionStorage.setItem('crm:navegacao:v1:1:FuturosClientesPage:abaSelecionada', '"consultoras"');
    render(<MemoryRouter initialEntries={['/futuros-clientes?aba=meus']}><FuturosClientesPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Meus Futuros Clientes' })).toHaveClass('active');
  });

  it('não aplica filtros antigos ao destino explícito de um lead', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    sessionStorage.setItem('crm:navegacao:v1:1:FuturosClientesMainView:meus:false:busca', '"Outra empresa"');
    sessionStorage.setItem('crm:navegacao:v1:1:FuturosClientesMainView:meus:false:pagina', '4');
    render(<MemoryRouter initialEntries={['/futuros-clientes?aba=meus&linha_id=42']}><FuturosClientesPage /></MemoryRouter>);
    await waitFor(() => expect(listarFuturosClientesLeads).toHaveBeenCalledWith({ linha_id: 42, page: 1, page_size: 50, status: undefined }));
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
    await user.selectOptions(screen.getByLabelText('Filtrar pelo usuário que fez a primeira ligação'), '7');
    await user.selectOptions(screen.getByLabelText('Filtrar destino dos futuros clientes'), 'distribuicao');
    await user.type(screen.getByText('Marcado a partir de').parentElement.querySelector('input'), '2026-08-01');
    await user.type(screen.getByText('Marcado até').parentElement.querySelector('input'), '2026-08-20');

    await waitFor(() => expect(listarQuadroFuturosClientes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        responsavel_id: '7',
        primeira_ligacao_id: '7',
        destino: 'distribuicao',
        marcado_de: '2026-08-01',
        marcado_ate: '2026-08-20'
      })
    ));
    expect(screen.getByRole('button', { name: 'Mais filtros (5)' })).toBeVisible();
  });

  it('revalida silenciosamente a lista a cada 30 segundos', async () => {
    const callbacks = [];
    const intervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((callback, atraso) => {
      if (atraso === 30000) callbacks.push(callback);
      return callbacks.length;
    });
    const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    try {
      render(
        <MemoryRouter initialEntries={['/futuros-clientes']}>
          <FuturosClientesPage />
        </MemoryRouter>
      );
      await waitFor(() => expect(listarFuturosClientesLeads).toHaveBeenCalledTimes(1));

      act(() => callbacks.forEach(callback => callback()));

      await waitFor(() => expect(listarFuturosClientesLeads.mock.calls.length).toBeGreaterThan(1));
      expect(screen.queryByText('Carregando futuros clientes...')).not.toBeInTheDocument();
    } finally {
      intervalSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it('atualiza ao voltar para a aba e fecha o detalhe que deixou de estar disponivel', async () => {
    listarFuturosClientesLeads
      .mockResolvedValueOnce({
        data: [{
          id: 42,
          futuro_cliente: true,
          futuro_cliente_destino: 'carteira',
          futuro_cliente_marcado_por_id: 1,
          futuro_cliente_marcado_em: '2026-08-20T15:00:00.000Z',
          status_operacional: 'qualificado',
          dados_json: { Empresa: 'Cliente em atendimento' },
          envio: { nome: 'Carteira Teste' },
          estado_atual: { codigo: 'na_carteira', rotulo: 'Na carteira' }
        }],
        total: 1
      })
      .mockResolvedValue({ data: [], total: 0 });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/futuros-clientes']}>
        <FuturosClientesPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByText('Carteira Teste'));
    expect(screen.getByRole('dialog')).toBeVisible();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(listarFuturosClientesLeads).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

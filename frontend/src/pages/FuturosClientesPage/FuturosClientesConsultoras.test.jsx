import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuturosClientesPage from './FuturosClientesPage';
import { formatarTempoRetornoConsultora } from './lead-status';
import {
  listarFuturosClientesComConsultoras,
  listarMeusFuturosClientesEmAcompanhamento,
  obterFuturoClienteEmAcompanhamento,
  obterMeuFuturoClienteEmAcompanhamento
} from '../../services/lead-planilha.service';

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
    listarFuturosClientesComConsultoras: vi.fn(),
    listarMeusFuturosClientesEmAcompanhamento: vi.fn(),
    obterFuturoClienteEmAcompanhamento: vi.fn(),
    obterMeuFuturoClienteEmAcompanhamento: vi.fn()
  };
});

describe('aba de futuros clientes com consultoras', () => {
  beforeEach(() => {
    authState.gerente = true;
    vi.clearAllMocks();
    const resultado = {
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
    };
    listarFuturosClientesComConsultoras.mockResolvedValue(resultado);
    listarMeusFuturosClientesEmAcompanhamento.mockResolvedValue(resultado);
    const detalhe = {
      linha: {
        id: 12,
        futuro_cliente: true,
        dados_json: { Empresa: 'Empresa Exemplo Ltda', Telefone: '31999999999' },
        envio: { nome: 'Indicação #12' },
        sondagem: null,
        atribuicao_para_id: 7,
        detalhes_bloqueados: false
      }
    };
    obterFuturoClienteEmAcompanhamento.mockResolvedValue(detalhe);
    obterMeuFuturoClienteEmAcompanhamento.mockResolvedValue(detalhe);
  });

  afterEach(() => cleanup());

  it('mostra o escopo global para gestores e o individual para usuarios comuns', () => {
    const { unmount } = render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Com consultoras' })).toBeVisible();
    unmount();

    authState.gerente = false;
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Com consultoras' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meus prazos' })).toBeVisible();
  });

  it('usuario comum ve a tabela completa consultando somente o endpoint individual', async () => {
    authState.gerente = false;
    const user = userEvent.setup();
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Meus prazos' }));

    expect(await screen.findByText('Empresa Exemplo Ltda')).toBeVisible();
    expect(screen.getByText('00.123.456/0001-99')).toBeVisible();
    expect(screen.getByText('Ana Consultora')).toBeVisible();
    expect(screen.getByText('Retorno marcado')).toBeVisible();
    expect(screen.getByText('Prazo vencido')).toBeVisible();
    expect(listarMeusFuturosClientesEmAcompanhamento).toHaveBeenCalledWith({
      page: 1,
      page_size: 30,
      busca: undefined
    });
    expect(listarFuturosClientesComConsultoras).not.toHaveBeenCalled();
  });

  it('permite abrir Meus prazos diretamente pela URL', async () => {
    authState.gerente = false;
    render(<MemoryRouter initialEntries={['/futuros-clientes?aba=consultoras']}><FuturosClientesPage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: 'Meus prazos' })).toHaveClass('active');
    expect(await screen.findByText('Empresa Exemplo Ltda')).toBeVisible();
    expect(listarMeusFuturosClientesEmAcompanhamento).toHaveBeenCalled();
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

  it('abre os detalhes em modo leitura ao clicar na linha do usuario comum', async () => {
    authState.gerente = false;
    const user = userEvent.setup();
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Meus prazos' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir detalhes de Empresa Exemplo Ltda' }));

    expect(await screen.findByRole('dialog', { name: 'Detalhes do futuro cliente' })).toBeVisible();
    expect(screen.getByText('Dados da planilha')).toBeVisible();
    expect(screen.getByText('31999999999')).toBeVisible();
    expect(obterMeuFuturoClienteEmAcompanhamento).toHaveBeenCalledWith(12);
    expect(obterFuturoClienteEmAcompanhamento).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Salvar/ })).not.toBeInTheDocument();
  });

  it('usa o detalhe global para quem possui permissao de ver todos', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FuturosClientesPage /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Com consultoras' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir detalhes de Empresa Exemplo Ltda' }));

    expect(await screen.findByRole('dialog', { name: 'Detalhes do futuro cliente' })).toBeVisible();
    expect(obterFuturoClienteEmAcompanhamento).toHaveBeenCalledWith(12);
    expect(obterMeuFuturoClienteEmAcompanhamento).not.toHaveBeenCalled();
  });

  it('formata a contagem regressiva sem exibir valores negativos', () => {
    const agora = new Date('2026-08-21T12:00:00.000Z').getTime();
    expect(formatarTempoRetornoConsultora('2026-08-21T13:05:00.000Z', agora)).toBe('1h 5min');
    expect(formatarTempoRetornoConsultora('2026-08-21T11:59:59.000Z', agora)).toBe('Prazo vencido');
    expect(formatarTempoRetornoConsultora(null, agora)).toBe('-');
  });
});

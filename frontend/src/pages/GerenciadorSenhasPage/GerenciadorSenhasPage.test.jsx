import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GerenciadorSenhasPage from './GerenciadorSenhasPage';

const api = vi.hoisted(() => ({ listarCredenciais: vi.fn(), revelarSenha: vi.fn() }));
vi.mock('../../services/gerenciador-senhas.service', () => api);
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));

const usuarios = [
  { id: 1, nome: 'Ana', email: 'ana@teste.local', funcao: 'admin', ativo: true, senha_disponivel: true },
  { id: 2, nome: 'Bruno', email: 'bruno@teste.local', funcao: 'usuario', ativo: false, senha_disponivel: true },
  { id: 3, nome: 'Carla', email: 'carla@teste.local', funcao: 'usuario', ativo: true, senha_disponivel: false }
];
const botaoAna = () => screen.getByRole('button', { name: 'Revelar senha de Ana' });

async function carregar() {
  const view = render(<GerenciadorSenhasPage />);
  await screen.findByText('ana@teste.local');
  return view;
}

describe('Gerenciador de senhas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    api.listarCredenciais.mockResolvedValue(usuarios);
    api.revelarSenha.mockResolvedValue({ senha: 'SenhaPrivada!123' });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lista metadados, contas inativas e antigas sem revelar automaticamente', async () => {
    await carregar();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(screen.getByText('Senha indisponível até a próxima troca')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /senha de Carla/ })).not.toBeInTheDocument();
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
    expect(api.revelarSenha).not.toHaveBeenCalled();
  });

  it('busca por nome e e-mail e mostra lista vazia', async () => {
    await carregar();
    const busca = screen.getByLabelText('Buscar por nome ou e-mail');
    fireEvent.change(busca, { target: { value: 'BRUNO' } });
    expect(screen.getByText('bruno@teste.local')).toBeInTheDocument();
    expect(screen.queryByText('ana@teste.local')).not.toBeInTheDocument();
    fireEvent.change(busca, { target: { value: '  ana@teste.local ' } });
    expect(screen.getByText('ana@teste.local')).toBeInTheDocument();
    fireEvent.change(busca, { target: { value: 'inexistente' } });
    expect(screen.getByText('Nenhum usuário encontrado.')).toBeInTheDocument();
  });

  it('revela somente a selecionada, oculta e não persiste a senha no navegador', async () => {
    await carregar();
    fireEvent.click(botaoAna());
    await screen.findByText('SenhaPrivada!123');
    expect(api.revelarSenha).toHaveBeenCalledExactlyOnceWith(1, expect.any(AbortSignal));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByRole('button', { name: 'Revelar senha de Bruno' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha de Ana' }));
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
    fireEvent.click(botaoAna());
    await screen.findByText('SenhaPrivada!123');
    expect(api.revelarSenha).toHaveBeenCalledTimes(2);
  });

  it('oculta após 30 segundos', async () => {
    await carregar();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(botaoAna()); });
    expect(screen.getByText('SenhaPrivada!123')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(29999));
    expect(screen.getByText('SenhaPrivada!123')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
  });

  it.each(['segundo plano', 'sessão encerrada', 'pagehide', 'outra aba', 'busca'])('limpa senha ao ocorrer %s', async evento => {
    await carregar();
    fireEvent.click(botaoAna());
    await screen.findByText('SenhaPrivada!123');
    act(() => {
      if (evento === 'segundo plano') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (evento === 'sessão encerrada') window.dispatchEvent(new Event('auth:sessao-encerrada'));
      else if (evento === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else if (evento === 'outra aba') window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: null }));
      else fireEvent.change(screen.getByLabelText('Buscar por nome ou e-mail'), { target: { value: 'Ana' } });
    });
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
  });

  it.each(['cancelamento', 'segundo plano', 'navegação', 'sessão encerrada'])('descarta resposta tardia após %s', async evento => {
    let resolver;
    api.revelarSenha.mockReturnValue(new Promise(resolve => { resolver = resolve; }));
    const view = await carregar();
    fireEvent.click(botaoAna());
    const signal = api.revelarSenha.mock.calls[0][1];
    if (evento === 'cancelamento') fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha de Ana' }));
    else if (evento === 'navegação') view.unmount();
    else if (evento === 'sessão encerrada') act(() => window.dispatchEvent(new Event('auth:sessao-encerrada')));
    else act(() => {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(signal.aborted).toBe(true);
    await act(async () => resolver({ senha: 'SenhaPrivada!123' }));
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
    if (evento === 'navegação') {
      await carregar();
      expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
    }
  });

  it('cancelar uma consulta antiga não interfere numa nova consulta da mesma conta', async () => {
    let resolverAntiga;
    let resolverNova;
    api.revelarSenha
      .mockImplementationOnce(() => new Promise(resolve => { resolverAntiga = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolverNova = resolve; }));
    await carregar();
    fireEvent.click(botaoAna());
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha de Ana' }));
    fireEvent.click(botaoAna());
    await act(async () => resolverAntiga({ senha: 'Antiga' }));
    expect(screen.queryByText('Antiga')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar senha de Ana' })).toHaveTextContent('Cancelar');
    await act(async () => resolverNova({ senha: 'Nova' }));
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  it('não revela na aba oculta e mostra erros de consulta sem credenciais', async () => {
    await carregar();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent.click(botaoAna());
    expect(api.revelarSenha).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    api.revelarSenha.mockRejectedValue(new Error('Gerenciador indisponível.'));
    fireEvent.click(botaoAna());
    expect(await screen.findByRole('alert')).toHaveTextContent('Gerenciador indisponível.');
    await waitFor(() => expect(botaoAna()).toBeInTheDocument());
    expect(screen.queryByText('SenhaPrivada!123')).not.toBeInTheDocument();
  });

  it('mostra erro de listagem e aborta a consulta ao desmontar', async () => {
    api.listarCredenciais.mockRejectedValue(new Error('Não foi possível carregar.'));
    const view = render(<GerenciadorSenhasPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar.');
    const signal = api.listarCredenciais.mock.calls[0][0];
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VerificarAcessoPage from './VerificarAcessoPage';
import LoginPage from './LoginPage';
import { login, logout, validarAcessoRede } from '../../services/auth.service';
import { SESSION_EXPIRED_MESSAGE } from '../../utils/sessao-codigo';

const estilosGlobais = readFileSync('src/styles/global.css', 'utf8');

vi.mock('../../services/auth.service', () => ({ login: vi.fn(), logout: vi.fn(), validarAcessoRede: vi.fn() }));

function montar(pagina = <VerificarAcessoPage />) {
  return render(<MemoryRouter initialEntries={['/origem']}><Routes>
    <Route path="/origem" element={pagina} />
    <Route path="/verificar-acesso" element={<VerificarAcessoPage />} />
    <Route path="/" element={<p>CRM liberado</p>} />
    <Route path="/login" element={<p>Tela de login</p>} />
  </Routes></MemoryRouter>);
}

describe('autorização de acesso externo', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem('acesso_rede_pendente', JSON.stringify({ solicitacao_id: 'solicitacao-teste', expira_em: new Date(Date.now() + 1800000).toISOString() }));
    logout.mockResolvedValue({});
  });

  it('posiciona voltar à esquerda e liberar em verde à direita, com foco na mesma ordem', async () => {
    const user = userEvent.setup();
    render(<style>{estilosGlobais}</style>);
    montar();
    const voltar = screen.getByRole('button', { name: 'Voltar ao login' });
    const liberar = screen.getByRole('button', { name: 'Liberar acesso' });
    const acoes = voltar.parentElement;

    expect(Array.from(acoes.children)).toEqual([voltar, liberar]);
    expect(getComputedStyle(acoes).display).toBe('flex');
    expect(getComputedStyle(acoes).justifyContent).toBe('space-between');
    // O jsdom não resolve var() em cores; verificamos a regra aplicada e seu token.
    const regraVerde = Array.from(document.querySelector('style').sheet.cssRules)
      .find(regra => regra.selectorText === '.login-access-actions .login-access-submit');
    expect(liberar.matches(regraVerde.selectorText)).toBe(true);
    expect(regraVerde.style.getPropertyValue('background')).toBe('var(--success)');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--success').trim()).toBe('#15803d');
    expect(getComputedStyle(liberar).color).toBe('rgb(255, 255, 255)');
    expect(liberar).toBeDisabled();

    await user.type(screen.getByLabelText('Código de 6 letras'), 'ABCDEF');
    expect(liberar).toBeEnabled();
    await user.tab();
    expect(voltar).toHaveFocus();
    await user.tab();
    expect(liberar).toHaveFocus();
  });

  it('normaliza seis letras, valida a solicitação e abre o CRM', async () => {
    const user = userEvent.setup();
    validarAcessoRede.mockResolvedValue({ token: 'jwt', usuario: {} });
    montar();
    expect(screen.getByText(/Código válido por (29min|30min)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Código de 6 letras'), 'abc123def');
    expect(screen.getByLabelText('Código de 6 letras')).toHaveValue('ABCDEF');
    await user.click(screen.getByRole('button', { name: 'Liberar acesso' }));
    expect(validarAcessoRede).toHaveBeenCalledWith('solicitacao-teste', 'ABCDEF');
    expect(await screen.findByText('CRM liberado')).toBeInTheDocument();
  });

  it('exibe código incorreto sem criar sessão nem repetir a validação', async () => {
    const user = userEvent.setup();
    validarAcessoRede.mockRejectedValue(new Error('Código incorreto.'));
    montar();
    await user.type(screen.getByLabelText('Código de 6 letras'), 'ABCDEF');
    await user.click(screen.getByRole('button', { name: 'Liberar acesso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorreto.');
    expect(validarAcessoRede).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('CRM liberado')).not.toBeInTheDocument();
  });

  it('bloqueia envio de código expirado e permite voltar ao login encerrando a sessão', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('acesso_rede_pendente', JSON.stringify({ solicitacao_id: 'teste', expira_em: new Date(Date.now() - 1).toISOString() }));
    montar();
    expect(screen.getByRole('button', { name: 'Liberar acesso' })).toBeDisabled();
    expect(screen.getByText(/Código expirado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao login' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
  });

  it('sem solicitação válida retorna ao login', async () => {
    sessionStorage.setItem('acesso_rede_pendente', 'json inválido');
    montar();
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
  });

  it('explica bloqueio por navegador e que o código não cadastra autorização permanente', () => {
    sessionStorage.setItem('acesso_rede_pendente', JSON.stringify({ modo: 'dispositivo', solicitacao_id: 'id-dispositivo', expira_em: new Date(Date.now() + 1800000).toISOString() }));
    montar();
    expect(screen.getByRole('heading', { name: 'Autorizar acesso neste navegador' })).toBeInTheDocument();
    expect(screen.getByText(/não cadastra o navegador/)).toBeInTheDocument();
    expect(screen.getByText(/sessão dura até duas horas/)).toBeInTheDocument();
  });

  it('login apresenta e consome o aviso de expiração da sessão liberada por código', () => {
    sessionStorage.setItem('logout_message', SESSION_EXPIRED_MESSAGE);
    montar(<LoginPage />);
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument();
    expect(sessionStorage.getItem('logout_message')).toBeNull();
  });

  it('login externo abre a etapa de código sem abrir o CRM', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(Object.assign(new Error('Rede externa'), { code: 'NETWORK_ACCESS_REQUIRED' }));
    montar(<LoginPage />);
    await user.type(screen.getByPlaceholderText('seu@email.com'), 'ana@crm.local');
    await user.type(screen.getByPlaceholderText('••••••••'), 'Senha123');
    await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Autorizar acesso neste navegador' })).toBeInTheDocument();
    expect(screen.queryByText('CRM liberado')).not.toBeInTheDocument();
  });
});

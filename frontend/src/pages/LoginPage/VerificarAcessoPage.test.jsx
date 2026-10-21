import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VerificarAcessoPage from './VerificarAcessoPage';
import LoginPage from './LoginPage';
import { login, logout, validarAcessoRede } from '../../services/auth.service';

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
    sessionStorage.setItem('acesso_rede_pendente', JSON.stringify({ solicitacao_id: 'solicitacao-teste', expira_em: new Date(Date.now() + 600000).toISOString() }));
    logout.mockResolvedValue({});
  });

  it('normaliza seis letras, valida a solicitação e abre o CRM', async () => {
    const user = userEvent.setup();
    validarAcessoRede.mockResolvedValue({ token: 'jwt', usuario: {} });
    montar();
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

  it('login externo abre a etapa de código sem abrir o CRM', async () => {
    const user = userEvent.setup();
    login.mockRejectedValue(Object.assign(new Error('Rede externa'), { code: 'NETWORK_ACCESS_REQUIRED' }));
    montar(<LoginPage />);
    await user.type(screen.getByPlaceholderText('seu@email.com'), 'ana@crm.local');
    await user.type(screen.getByPlaceholderText('••••••••'), 'Senha123');
    await user.click(screen.getByRole('button', { name: 'Entrar', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Autorizar acesso externo' })).toBeInTheDocument();
    expect(screen.queryByText('CRM liberado')).not.toBeInTheDocument();
  });
});

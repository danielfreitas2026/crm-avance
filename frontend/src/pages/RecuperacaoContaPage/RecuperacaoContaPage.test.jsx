import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecuperacaoContaPage from './RecuperacaoContaPage';
import { confirmarEmailRecuperacao, solicitarRecuperacao, redefinirSenha, logout } from '../../services/auth.service';

vi.mock('../../services/auth.service', () => ({
  confirmarEmailRecuperacao: vi.fn(), solicitarRecuperacao: vi.fn(), redefinirSenha: vi.fn(), logout: vi.fn()
}));

const token = 'a'.repeat(64);
function abrir(tipo, hash = `#token=${token}`) {
  render(<MemoryRouter initialEntries={[`/recuperacao${hash}`]}>
    <Routes>
      <Route path="/recuperacao" element={<RecuperacaoContaPage tipo={tipo} />} />
      <Route path="/login" element={<h1>Tela de login</h1>} />
    </Routes>
  </MemoryRouter>);
}

describe('recuperação pública de conta', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });

  it('solicita pelo identificador de acesso e informa orientação sem revelar destinatário', async () => {
    solicitarRecuperacao.mockResolvedValue({ message: 'Se a conta estiver ativa e possuir um e-mail de recuperação confirmado, enviaremos as instruções.' });
    abrir('solicitar', '');
    fireEvent.change(screen.getByLabelText('E-mail de acesso'), { target: { value: 'ana@crm.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Se a conta estiver ativa');
    expect(solicitarRecuperacao).toHaveBeenCalledWith('ana@crm.local');
    expect(screen.getByText(/Procure um administrador/)).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('abrir confirmação não consome token; o clique explícito envia somente o token', async () => {
    confirmarEmailRecuperacao.mockResolvedValue({ message: 'E-mail confirmado.' });
    abrir('confirmar');
    expect(confirmarEmailRecuperacao).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    expect(await screen.findByRole('status')).toHaveTextContent('E-mail confirmado.');
    expect(confirmarEmailRecuperacao).toHaveBeenCalledWith(token);
  });

  it.each(['confirmar', 'redefinir'])('bloqueia %s quando falta token e mostra alternativa', tipo => {
    abrir(tipo, '');
    expect(screen.getByRole('alert')).toHaveTextContent('Link inválido');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao login' })).toHaveAttribute('href', '/login');
  });

  it('valida confirmação de senha, regras e bytes antes de chamar API', async () => {
    abrir('redefinir');
    const senha = screen.getByLabelText('Nova senha');
    const confirmar = screen.getByLabelText('Confirme a nova senha');
    const salvar = screen.getByRole('button', { name: 'Salvar nova senha' });
    fireEvent.change(senha, { target: { value: 'Nova1234' } });
    fireEvent.change(confirmar, { target: { value: 'Outra1234' } });
    fireEvent.click(salvar);
    expect(screen.getByRole('alert')).toHaveTextContent('não coincidem');
    for (const valor of ['curta1', 'semnumero', 'á'.repeat(36) + '1']) {
      fireEvent.change(senha, { target: { value: valor } });
      fireEvent.change(confirmar, { target: { value: valor } });
      fireEvent.click(salvar);
      expect(screen.getByRole('alert')).toHaveTextContent('72 bytes');
    }
    expect(redefinirSenha).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar senhas' }));
    expect(senha).toHaveAttribute('type', 'text');
    expect(confirmar).toHaveAttribute('type', 'text');
  });

  it('redefine, limpa sessão local e encaminha ao login sem autenticação automática', async () => {
    redefinirSenha.mockResolvedValue({ message: 'Senha redefinida com sucesso.' });
    abrir('redefinir');
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Nova1234' } });
    fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: 'Nova1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Senha redefinida');
    expect(redefinirSenha).toHaveBeenCalledWith(token, 'Nova1234');
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Tela de login' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('mostra erro de link expirado sem encerrar a sessão existente', async () => {
    confirmarEmailRecuperacao.mockRejectedValue(new Error('Link inválido ou expirado.'));
    abrir('confirmar');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Link inválido ou expirado');
    expect(logout).not.toHaveBeenCalled();
  });

  it('desabilita envio enquanto aguarda a resposta e permite tentar após falha', async () => {
    let rejeitar;
    solicitarRecuperacao.mockReturnValue(new Promise((_resolve, reject) => { rejeitar = reject; }));
    abrir('solicitar', '');
    fireEvent.change(screen.getByLabelText('E-mail de acesso'), { target: { value: 'ana@crm.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }));
    expect(screen.getByRole('button', { name: 'Aguarde...' })).toBeDisabled();
    rejeitar(new Error('Muitas solicitações.'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar instruções' })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Muitas solicitações');
  });
});

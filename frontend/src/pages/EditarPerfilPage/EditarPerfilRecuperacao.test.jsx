import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditarPerfilPage from './EditarPerfilPage';
import { atualizarPerfil, buscarPerfil, reenviarConfirmacaoEmailRecuperacao } from '../../services/auth.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({
  atualizarPerfil: vi.fn(), buscarPerfil: vi.fn(), reenviarConfirmacaoEmailRecuperacao: vi.fn()
}));

const perfil = { id: 1, nome: 'Ana', email: 'ana@crm.local', role: { nome: 'usuario' }, ativo: true };
async function abrir(dados = {}) {
  buscarPerfil.mockResolvedValue({ ...perfil, ...dados });
  render(<MemoryRouter><EditarPerfilPage /></MemoryRouter>);
  return screen.findByLabelText('E-mail de recuperação');
}

describe('e-mail de recuperação no perfil', () => {
  beforeEach(() => vi.resetAllMocks());

  it('permite usuário comum configurar endereço e exige senha atual', async () => {
    const input = await abrir();
    expect(screen.getByRole('status')).toHaveTextContent('Não configurado');
    fireEvent.change(input, { target: { value: 'real@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(screen.getByText('Informe sua senha atual para alterar o e-mail de recuperação.')).toBeInTheDocument();
    expect(atualizarPerfil).not.toHaveBeenCalled();
    atualizarPerfil.mockResolvedValue({ ...perfil, email_recuperacao_pendente: 'real@example.com' });
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'Atual123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(atualizarPerfil).toHaveBeenCalledWith({ email_recuperacao: 'real@example.com', senha_atual: 'Atual123' }));
    expect(await screen.findByText('Aguardando confirmação')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha atual')).toHaveValue('');
  });

  it('mostra endereço confirmado durante substituição e permite reenviar com senha', async () => {
    await abrir({ email_recuperacao: 'antigo@example.com', email_recuperacao_pendente: 'novo@example.com', email_recuperacao_confirmado_em: '2026-10-19' });
    expect(screen.getByText('Endereço confirmado: antigo@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar confirmação' }));
    expect(reenviarConfirmacaoEmailRecuperacao).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'Atual123' } });
    reenviarConfirmacaoEmailRecuperacao.mockResolvedValue({ message: 'E-mail de confirmação reenviado.' });
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar confirmação' }));
    expect(await screen.findByText('E-mail de confirmação reenviado.')).toBeInTheDocument();
    expect(reenviarConfirmacaoEmailRecuperacao).toHaveBeenCalledWith('Atual123');
  });

  it('remove endereço somente ao salvar com senha atual', async () => {
    const input = await abrir({ email_recuperacao: 'real@example.com', email_recuperacao_confirmado_em: '2026-10-19' });
    expect(screen.getByRole('status')).toHaveTextContent('Confirmado');
    fireEvent.click(screen.getByRole('button', { name: 'Remover e-mail de recuperação' }));
    expect(input).toHaveValue('');
    expect(atualizarPerfil).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'Atual123' } });
    atualizarPerfil.mockResolvedValue({ ...perfil, email_recuperacao: null, email_recuperacao_confirmado_em: null });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(atualizarPerfil).toHaveBeenCalledWith({ email_recuperacao: null, senha_atual: 'Atual123' }));
    expect(await screen.findByText('Não configurado')).toBeInTheDocument();
  });

  it('preserva fluxo de alteração da senha sem exigir senha atual nem reenviar confirmação', async () => {
    await abrir({ email_recuperacao: 'real@example.com', email_recuperacao_confirmado_em: '2026-10-19' });
    atualizarPerfil.mockResolvedValue({ ...perfil, email_recuperacao: 'real@example.com', email_recuperacao_confirmado_em: '2026-10-19' });
    fireEvent.change(screen.getByPlaceholderText('Deixe em branco para manter'), { target: { value: 'Nova1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(atualizarPerfil).toHaveBeenCalledWith({ senha: 'Nova1234' }));
    expect(reenviarConfirmacaoEmailRecuperacao).not.toHaveBeenCalled();
  });

  it('apresenta falha SMTP e mantém a edição disponível sem indicar sucesso', async () => {
    const input = await abrir();
    atualizarPerfil.mockRejectedValue(new Error('Não foi possível enviar o e-mail.'));
    fireEvent.change(input, { target: { value: 'real@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'Atual123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByText('Não foi possível enviar o e-mail.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
    expect(screen.queryByText(/Enviamos um link/)).not.toBeInTheDocument();
  });
});

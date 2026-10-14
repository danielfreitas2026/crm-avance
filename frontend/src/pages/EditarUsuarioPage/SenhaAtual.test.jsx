import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SenhaAtual from './SenhaAtual';
import { visualizarSenhaUsuario } from '../../services/usuario.service';

vi.mock('../../services/usuario.service', () => ({ visualizarSenhaUsuario: vi.fn() }));

describe('Visualização da senha atual', () => {
  beforeEach(() => vi.resetAllMocks());

  it('consulta somente ao clicar e limpa ao ocultar; nova consulta busca o valor atualizado', async () => {
    visualizarSenhaUsuario.mockResolvedValueOnce({ senha: 'primeira' }).mockResolvedValueOnce({ senha: 'segunda' });
    render(<SenhaAtual id="2" />);
    expect(visualizarSenhaUsuario).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar senha atual' }));
    expect(await screen.findByLabelText('Senha atual')).toHaveValue('primeira');
    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('readonly');
    expect(visualizarSenhaUsuario).toHaveBeenCalledWith('2');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar senha atual' }));
    await waitFor(() => expect(screen.getByLabelText('Senha atual')).toHaveValue('segunda'));
  });

  it.each([
    'A senha atual não está disponível para visualização. Ela ficará disponível após uma nova troca de senha.',
    'Você não tem permissão para executar esta ação.',
    'Não foi possível visualizar a senha.'
  ])('mostra o erro sem revelar senha: %s', async mensagem => {
    visualizarSenhaUsuario.mockRejectedValue(new Error(mensagem));
    render(<SenhaAtual id="2" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent(mensagem);
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('bloqueia consultas duplicadas e ignora resposta pendente após troca de usuário ou salvamento', async () => {
    let resolver;
    visualizarSenhaUsuario.mockReturnValue(new Promise(resolve => { resolver = resolve; }));
    const { rerender } = render(<SenhaAtual key="2-false" id="2" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Consultando senha...' })).toBeDisabled();
    rerender(<SenhaAtual key="3-false" id="3" />);
    await act(async () => resolver({ senha: 'segredo-antigo' }));
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    visualizarSenhaUsuario.mockResolvedValue({ senha: 'atual' });
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByLabelText('Senha atual')).toHaveValue('atual');
    rerender(<SenhaAtual key="3-true" id="3" disabled />);
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<SenhaAtual key="3-false" id="3" />);
    expect(screen.queryByLabelText('Senha atual')).not.toBeInTheDocument();
  });
});

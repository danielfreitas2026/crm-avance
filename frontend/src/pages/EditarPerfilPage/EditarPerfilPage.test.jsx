import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditarPerfilPage from './EditarPerfilPage';
import { atualizarPerfil, buscarPerfil } from '../../services/auth.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({
  atualizarPerfil: vi.fn(), buscarPerfil: vi.fn(), reenviarConfirmacaoEmailRecuperacao: vi.fn()
}));

const perfil = { nome: 'Ana Silva', email: 'ana@crm.local', role: { nome: 'usuario' }, ativo: true };
async function abrir(dados = {}) {
  buscarPerfil.mockResolvedValue({ ...perfil, ...dados });
  render(<MemoryRouter><EditarPerfilPage /></MemoryRouter>);
  await screen.findByLabelText('E-mail de recuperação');
}

describe('edição de perfil: apresentação e acessibilidade', () => {
  beforeEach(() => vi.resetAllMocks());

  it('agrupa conta, recuperação e nova senha em regiões com rótulos e instruções', async () => {
    await abrir();
    const conta = screen.getByRole('region', { name: 'Dados da conta' });
    const recuperacao = screen.getByRole('region', { name: 'Recuperação de conta' });
    const senha = screen.getByRole('region', { name: 'Alterar senha' });
    expect(within(conta).getByLabelText('Nome de exibição')).toBeDisabled();
    expect(within(conta).getByLabelText('E-mail de acesso')).toBeDisabled();
    expect(within(recuperacao).getByLabelText('Senha atual')).toHaveAccessibleDescription(/Obrigatória para cadastrar/);
    expect(within(recuperacao).getByLabelText('E-mail de recuperação')).toHaveAccessibleDescription(/Seu e-mail de acesso ao CRM continua o mesmo/);
    expect(within(senha).getByLabelText('Nova senha')).toHaveAccessibleDescription(/Deixe em branco/);
    expect(within(recuperacao).queryByLabelText('Nova senha')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  });

  it.each([
    [{}, 'Não configurado', null],
    [{ email_recuperacao: 'real@example.com', email_recuperacao_confirmado_em: '2026-10-19' }, 'Confirmado', 'success'],
    [{ email_recuperacao_pendente: 'novo@example.com' }, 'Aguardando confirmação', 'warn']
  ])('apresenta o estado de recuperação com texto e selo: %s', async (dados, texto, cor) => {
    await abrir(dados);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(texto);
    expect(status).toHaveClass('pill');
    if (cor) expect(status).toHaveClass(cor);
    else expect(status).not.toHaveClass('success', 'warn');
  });

  it('permite alcançar a seleção de foto pelo teclado, pré-visualizar e salvar somente a foto', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
    await user.tab();
    const input = screen.getByLabelText('Escolher foto');
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription('PNG, JPG ou WEBP até 4 MB.');
    await user.upload(input, new File(['foto'], 'foto.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getAllByRole('img', { name: perfil.nome })).toHaveLength(2));
    const foto = screen.getAllByRole('img', { name: perfil.nome })[0].getAttribute('src');
    expect(foto).toMatch(/^data:image\/png;base64,/);
    atualizarPerfil.mockResolvedValue({ ...perfil, foto_perfil: foto });
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(atualizarPerfil).toHaveBeenCalledWith({ foto_perfil: foto });
    expect(await screen.findByText('Alteracoes salvas com sucesso.')).toBeInTheDocument();
  });

  it.each([
    [new File(['arquivo'], 'foto.gif', { type: 'image/gif' }), 'Use uma imagem PNG, JPG ou WEBP.'],
    [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'foto.png', { type: 'image/png' }), 'A foto deve ter até 4 MB.']
  ])('preserva a validação de foto inválida (caso %#)', async (arquivo, mensagem) => {
    await abrir();
    fireEvent.change(screen.getByLabelText('Escolher foto'), { target: { files: [arquivo] } });
    expect(screen.getByRole('alert')).toHaveTextContent(mensagem);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(atualizarPerfil).not.toHaveBeenCalled();
  });

  it('alterna a visibilidade da nova senha sem alterar seu valor e informa a força', async () => {
    await abrir();
    const input = screen.getByLabelText('Nova senha');
    fireEvent.change(input, { target: { value: 'Nova1234!' } });
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByText('Forte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar senha' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Nova1234!');
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('permite ao administrador salvar somente o nome e mostra o estado de salvamento', async () => {
    await abrir({ role: { nome: 'admin' } });
    const input = screen.getByLabelText('Nome de exibição');
    expect(input).toBeEnabled();
    let concluir;
    atualizarPerfil.mockReturnValue(new Promise(resolve => { concluir = resolve; }));
    fireEvent.change(input, { target: { value: 'Ana Souza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled();
    expect(atualizarPerfil).toHaveBeenCalledWith({ nome: 'Ana Souza' });
    concluir({ ...perfil, nome: 'Ana Souza', role: { nome: 'admin' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled());
  });
});

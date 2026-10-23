import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DispositivosAcessoConfig from './DispositivosAcessoConfig';
import { apiDelete, apiGet, apiPost } from '../../services/api';

vi.mock('../../services/api', () => ({ apiDelete: vi.fn(), apiGet: vi.fn(), apiPost: vi.fn() }));
const ENDPOINT = '/config/admin/acesso-rede/dispositivos';
const dispositivo = { id: 'id-navegador', nome: 'Recepção', responsavel_nome: 'Ana', cadastrado_em: '2026-10-23T12:00:00Z', revogado_em: null };
const lista = { dispositivo_atual_id: dispositivo.id, dispositivos: [dispositivo] };

describe('navegadores autorizados', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue(lista);
    apiPost.mockResolvedValue({ dispositivo });
    apiDelete.mockResolvedValue({});
  });

  it('mostra responsável, data, situação e identificação do navegador atual', async () => {
    render(<DispositivosAcessoConfig />);
    expect(await screen.findByText('Recepção')).toBeInTheDocument();
    expect(screen.getByText(/Responsável: Ana/)).toBeInTheDocument();
    expect(screen.getByText(/Este navegador/)).toBeInTheDocument();
    expect(screen.getByText('Situação: Autorizado.')).toBeInTheDocument();
  });

  it('envia nome e senha e confirma o cookie antes de anunciar autorização', async () => {
    const user = userEvent.setup();
    render(<DispositivosAcessoConfig />);
    await screen.findByText('Recepção');
    await user.type(screen.getByLabelText('Nome deste navegador'), 'Mesa');
    await user.type(screen.getByLabelText('Sua senha atual'), 'MinhaSenha');
    await user.click(screen.getByRole('button', { name: 'Autorizar este navegador' }));
    expect(apiPost).toHaveBeenCalledWith(`${ENDPOINT}/atual`, { nome: 'Mesa', senha_atual: 'MinhaSenha' });
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('status')).toHaveTextContent('Este navegador foi autorizado');
    expect(screen.getByLabelText('Sua senha atual')).toHaveValue('');
  });

  it('informa falha quando o navegador não confirma o cookie', async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValueOnce(lista).mockResolvedValueOnce({ ...lista, dispositivo_atual_id: null });
    render(<DispositivosAcessoConfig />);
    await screen.findByText('Recepção');
    await user.type(screen.getByLabelText('Nome deste navegador'), 'Mesa');
    await user.type(screen.getByLabelText('Sua senha atual'), 'MinhaSenha');
    await user.click(screen.getByRole('button', { name: 'Autorizar este navegador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não confirmou a credencial');
    expect(screen.queryByText(/Este navegador foi autorizado/)).not.toBeInTheDocument();
  });

  it('exibe recusa de senha sem repetir o cadastro e limpa a senha digitada', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValue(new Error('Senha atual incorreta.'));
    render(<DispositivosAcessoConfig />);
    await screen.findByText('Recepção');
    await user.type(screen.getByLabelText('Nome deste navegador'), 'Mesa');
    await user.type(screen.getByLabelText('Sua senha atual'), 'Errada');
    await user.click(screen.getByRole('button', { name: 'Autorizar este navegador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha atual incorreta.');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Sua senha atual')).toHaveValue('');
  });

  it('exige confirmação para revogar e atualiza a lista', async () => {
    const user = userEvent.setup();
    render(<DispositivosAcessoConfig />);
    await user.click(await screen.findByRole('button', { name: 'Revogar Recepção' }));
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancelar revogação' }));
    expect(apiDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Revogar Recepção' }));
    apiGet.mockResolvedValue({ dispositivo_atual_id: null, dispositivos: [{ ...dispositivo, revogado_em: '2026-10-23T13:00:00Z' }] });
    await user.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    expect(apiDelete).toHaveBeenCalledWith(`${ENDPOINT}/${dispositivo.id}`);
    expect(await screen.findByText('Situação: Revogado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revogar Recepção' })).not.toBeInTheDocument();
  });

  it('informa falha de carregamento e impede cadastro sem lista', async () => {
    apiGet.mockRejectedValue(new Error('Sem acesso.'));
    render(<DispositivosAcessoConfig />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem acesso.');
    expect(screen.getByRole('button', { name: 'Autorizar este navegador' })).toBeDisabled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcessoRedeConfig from './AcessoRedeConfig';
import { apiGet, apiPut } from '../../services/api';

vi.mock('../../services/api', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('./DispositivosAcessoConfig', () => ({ default: () => <p>Cadastro de navegadores</p> }));
const config = { ativo: false, redes: ['203.0.113.10'], ip_detectado: '203.0.113.10', telegram_configurado: true, proxy_configurado: false };

describe('configuração do acesso por dispositivos', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue(config);
  });
  it('mostra Telegram e dispensa dos admins, salvando somente bloqueio por dispositivo', async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({ ...config, ativo: true, modo: 'dispositivo' });
    render(<AcessoRedeConfig />);
    expect(await screen.findByText('Telegram configurado: Sim.')).toBeInTheDocument();
    expect(screen.getByText(/Administradores e usuários/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Salvar controle de acesso' }));
    expect(apiPut).toHaveBeenCalledWith('/config/admin/acesso-rede', { ativo: true, modo: 'dispositivo' });
    expect(await screen.findByRole('status')).toHaveTextContent('Configuração salva');
  });
  it('mantém a edição e mostra a recusa de ativação recebida do servidor', async () => {
    const user = userEvent.setup();
    apiPut.mockRejectedValue(new Error('Configure o Telegram.'));
    render(<AcessoRedeConfig />);
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Salvar controle de acesso' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Configure o Telegram.');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
  it('não oferece controle por rede nem cadastro de IP e mantém cadastro de navegadores', async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({ ...config, modo: 'dispositivo' });
    render(<AcessoRedeConfig />);
    expect(await screen.findByRole('heading', { name: 'Acesso por dispositivos' })).toBeInTheDocument();
    expect(screen.getByText(/não é liberado pelo IP/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/IPs públicos/)).not.toBeInTheDocument();
    expect(screen.getByText('Cadastro de navegadores')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar controle de acesso' }));
    expect(apiPut).toHaveBeenCalledWith('/config/admin/acesso-rede', { ativo: false, modo: 'dispositivo' });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

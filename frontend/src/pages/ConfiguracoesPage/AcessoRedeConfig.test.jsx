import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AcessoRedeConfig from './AcessoRedeConfig';
import { apiGet, apiPut } from '../../services/api';

vi.mock('../../services/api', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('./DispositivosAcessoConfig', () => ({ default: () => <p>Cadastro de navegadores</p> }));
const config = { ativo: false, redes: ['203.0.113.10'], ip_detectado: '203.0.113.10', telegram_configurado: true, proxy_configurado: false };

describe('configuração do acesso por rede', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiGet.mockResolvedValue(config);
  });
  it('mostra diagnóstico, dispensa dos admins e salva redes IPv4/IPv6 e ativação', async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({ ...config, ativo: true, redes: ['203.0.113.10', '2001:db8::/32'] });
    render(<AcessoRedeConfig />);
    expect(await screen.findByText('203.0.113.10', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Administradores e usuários/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText(/IPs públicos/), '\n2001:db8::/32');
    await user.click(screen.getByRole('button', { name: 'Salvar controle de acesso' }));
    expect(apiPut).toHaveBeenCalledWith('/config/admin/acesso-rede', { ativo: true, modo: 'rede', redes: ['203.0.113.10', '2001:db8::/32'] });
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
  it('seleciona dispositivos, explica que IP não dispensa e preserva redes cadastradas', async () => {
    const user = userEvent.setup();
    apiPut.mockResolvedValue({ ...config, modo: 'dispositivo' });
    render(<AcessoRedeConfig />);
    await user.selectOptions(await screen.findByLabelText('Modo de controle de acesso'), 'dispositivo');
    expect(screen.getByText(/IPs cadastrados não liberam/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/IPs públicos/)).not.toBeInTheDocument();
    expect(screen.getByText('Cadastro de navegadores')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar controle de acesso' }));
    expect(apiPut).toHaveBeenCalledWith('/config/admin/acesso-rede', { ativo: false, modo: 'dispositivo', redes: config.redes });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

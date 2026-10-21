import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MensagensPage from './MensagensPage';
import { enviarMensagem, listarContatos, listarConversas, listarMensagens } from '../../services/mensagem.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 1 }),
  temPermissao: (_usuario, permissao) => permissao === 'chat_usar'
}));
vi.mock('../../services/mensagem.service', async original => ({
  ...(await original()),
  listarContatos: vi.fn(), listarConversas: vi.fn(), listarMensagens: vi.fn(), enviarMensagem: vi.fn()
}));

describe('navegação das mensagens', () => {
  beforeEach(() => {
    localStorage.setItem('usuario', '{"id":1}');
    listarContatos.mockResolvedValue([{ id: 7, nome: 'Ana', role: { nome: 'Vendedora' } }]);
    listarConversas.mockResolvedValue([]);
    listarMensagens.mockResolvedValue([{ id: 10, remetente_id: 7, destinatario_id: 1, conteudo: 'Mensagem atual do servidor', created_at: '2026-10-19T12:00:00Z' }]);
    enviarMensagem.mockClear();
  });

  it('reabre a conversa após F5 sem recuperar texto não enviado nem enviar mensagens', async () => {
    sessionStorage.setItem('crm:navegacao:v1:1:MensagensPage:minhas:conversa', '7');
    const first = render(<MensagensPage />);
    await screen.findByText('Mensagem atual do servidor');
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Texto não enviado');
    first.unmount();
    render(<MensagensPage />);
    await screen.findByText('Mensagem atual do servidor');
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(enviarMensagem).not.toHaveBeenCalled();
  });
});

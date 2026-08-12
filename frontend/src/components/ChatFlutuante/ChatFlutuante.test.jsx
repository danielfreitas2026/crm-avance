import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  baixarAnexoMensagem: vi.fn(),
  enviarMensagem: vi.fn(),
  enviarMensagensEmLote: vi.fn(),
  listarContatos: vi.fn(),
  listarConversas: vi.fn(),
  listarMensagens: vi.fn(),
  uploadAnexoMensagem: vi.fn()
}));

vi.mock('../../services/mensagem.service', () => api);

import ChatFlutuante from './ChatFlutuante';

describe('ChatFlutuante', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listarConversas.mockResolvedValue([]);
    api.listarMensagens.mockResolvedValue([]);
    api.listarContatos.mockResolvedValue([
      { id: 2, nome: 'Ana Souza', role: { nome: 'Vendas' } },
      { id: 3, nome: 'Beto Lima', role: { nome: 'Suporte' } }
    ]);
    api.uploadAnexoMensagem.mockResolvedValue({ arquivo_id: 10, nome_original: 'proposta.pdf', mime_type: 'application/pdf', tamanho_bytes: 100 });
    api.enviarMensagensEmLote.mockResolvedValue({ enviadas: [{ destinatario_id: 2 }], falhas: [], resumo: { solicitadas: 1, enviadas: 1, falhas: 0 } });
  });

  it('seleciona todos os contatos filtrados e envia texto com anexo em lote', async () => {
    const { container } = render(<ChatFlutuante usuario={{ id: 1 }} />);
    fireEvent.click(screen.getByLabelText('Abrir mensagens'));
    fireEvent.click(await screen.findByLabelText('Nova mensagem'));

    fireEvent.change(screen.getByPlaceholderText('Buscar usuário...'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByText('Selecionar resultados'));
    expect(screen.getByText('1 destinatário(s)')).toBeInTheDocument();

    const arquivo = new File(['pdf'], 'proposta.pdf', { type: 'application/pdf' });
    fireEvent.change(container.ownerDocument.querySelector('.chat-flutuante input[type="file"]'), { target: { files: [arquivo] } });
    await screen.findByText('proposta.pdf');
    fireEvent.change(screen.getByPlaceholderText('Escreva a mensagem...'), { target: { value: 'Olá, equipe' } });
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    await waitFor(() => expect(api.enviarMensagensEmLote).toHaveBeenCalledWith(
      [2],
      'Olá, equipe',
      { arquivo_id: 10, nome_original: 'proposta.pdf' }
    ));
  });

  it('mantem destinatario e rascunho quando o lote falha parcialmente', async () => {
    api.enviarMensagensEmLote.mockResolvedValue({
      enviadas: [{ destinatario_id: 2 }],
      falhas: [{ destinatario_id: 3, motivo: 'Usuário indisponível' }],
      resumo: { solicitadas: 2, enviadas: 1, falhas: 1 }
    });
    render(<ChatFlutuante usuario={{ id: 1 }} />);
    fireEvent.click(screen.getByLabelText('Abrir mensagens'));
    fireEvent.click(await screen.findByLabelText('Nova mensagem'));
    fireEvent.click(screen.getByText('Selecionar resultados'));
    fireEvent.change(screen.getByPlaceholderText('Escreva a mensagem...'), { target: { value: 'Aviso importante' } });
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    await screen.findByText(/Usuário indisponível/);
    expect(screen.getByPlaceholderText('Escreva a mensagem...')).toHaveValue('Aviso importante');
    expect(screen.getByText('1 destinatário(s)')).toBeInTheDocument();
  });
});

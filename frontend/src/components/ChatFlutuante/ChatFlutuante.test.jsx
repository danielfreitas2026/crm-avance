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

  it('renderiza o dock completo e abre ou minimiza a lista de conversas', async () => {
    render(<ChatFlutuante usuario={{ id: 1, nome: 'Maria Silva' }} naoLidas={3} />);

    const dock = document.querySelector('.chat-flutuante__atalho');
    expect(dock).toContainElement(screen.getByRole('button', { name: 'Abrir mensagens' }));
    expect(dock).toContainElement(screen.getByRole('button', { name: 'Nova mensagem' }));
    expect(dock).toContainElement(screen.getByRole('button', { name: 'Expandir mensagens' }));
    expect(screen.getByText('MS')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Expandir mensagens' }));
    expect(await screen.findByRole('dialog', { name: 'Mensagens rápidas' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar mensagens' }));
    expect(screen.getByRole('button', { name: 'Expandir mensagens' })).toBeVisible();
  });

  it('abre o compositor diretamente pela acao do dock', async () => {
    render(<ChatFlutuante usuario={{ id: 1, nome: 'Maria Silva' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Nova mensagem' }));
    expect(await screen.findByText('Nova mensagem')).toBeVisible();
    expect(screen.getByPlaceholderText('Buscar usuário...')).toBeVisible();
  });

  it('mantem o marcador de não visualizadas na aba e no painel aberto', async () => {
    render(<ChatFlutuante usuario={{ id: 1 }} naoLidas={3} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Abrir mensagens'));
    expect(await screen.findByLabelText('3 mensagem(ns) não visualizada(s)')).toBeInTheDocument();
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

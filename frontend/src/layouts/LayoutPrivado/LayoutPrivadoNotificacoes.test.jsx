import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/Sidebar/Sidebar', () => ({ default: () => null }));
vi.mock('../../components/ChatFlutuante/ChatFlutuante', () => ({ default: () => null }));
vi.mock('../../pages/VendasPage/VendaModal', () => ({ default: () => null }));
vi.mock('../../pages/Clientes/ClienteModal', () => ({ default: () => null }));
vi.mock('../../components/RetornoFuturoClientePopup/RetornoFuturoClientePopup', () => ({
  default: ({ notificacao }) => notificacao ? <div>Popup {notificacao.id}</div> : null
}));
vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 9 }),
  buscarPerfil: () => new Promise(() => {}),
  temPermissao: () => false,
  logout: vi.fn()
}));
vi.mock('../../services/config.service', () => ({
  listarAparenciasNotificacao: vi.fn().mockResolvedValue([]),
  listarLinksExternos: vi.fn().mockResolvedValue([]),
  listarOperadoras: vi.fn(), listarServicos: vi.fn(), listarTiposVenda: vi.fn()
}));
vi.mock('../../services/notificacao.service', () => ({
  listarNotificacoesUrgentes: vi.fn(),
  marcarTodasNotificacoesLidas: vi.fn(),
  excluirNotificacao: vi.fn(),
  marcarPopupNotificacaoVisto: vi.fn()
}));

import LayoutPrivado from './LayoutPrivado';
import { listarNotificacoesUrgentes, marcarTodasNotificacoesLidas } from '../../services/notificacao.service';

const avisos = [
  { id: 1, tipo: 'lead_retorno_due', titulo: 'Aviso antigo', mensagem: 'Retornar ligação', popup_retorno_futuro_disponivel: true },
  { id: 2, tipo: 'venda_cancelada', titulo: 'Venda cancelada', mensagem: 'Cancelamento' }
];

function adiar() {
  let resolve;
  let reject;
  const promise = new Promise((ok, falha) => { resolve = ok; reject = falha; });
  return { promise, resolve, reject };
}

async function abrir() {
  render(<MemoryRouter><LayoutPrivado><div>Conteúdo da página</div></LayoutPrivado></MemoryRouter>);
  const sino = await screen.findByRole('button', { name: /2 avisos pendentes/i });
  fireEvent.click(sino);
  return sino;
}

describe('leitura em lote na navbar', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    listarNotificacoesUrgentes.mockReset().mockResolvedValue({ notificacoes: avisos });
    marcarTodasNotificacoesLidas.mockReset();
  });

  it('bloqueia repetição, descarta polling antigo e reconcilia novos avisos e popup', async () => {
    const consultaAntiga = adiar();
    const envio = adiar();
    const novo = { id: 3, tipo: 'lead_retorno_due', titulo: 'Aviso novo', popup_retorno_futuro_disponivel: true };
    listarNotificacoesUrgentes.mockResolvedValueOnce({ notificacoes: avisos })
      .mockReturnValueOnce(consultaAntiga.promise)
      .mockResolvedValue({ notificacoes: [novo] });
    marcarTodasNotificacoesLidas.mockReturnValue(envio.promise);
    await abrir();
    expect(screen.getByText('Popup 1')).toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent('pos-venda:navbar-notificacoes-atualizar')));
    await waitFor(() => expect(listarNotificacoesUrgentes).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcando…' }));
    expect(marcarTodasNotificacoesLidas).toHaveBeenCalledExactlyOnceWith({ escopo: 'navbar' });
    expect(screen.getByText('Aviso antigo')).toBeInTheDocument();
    await act(async () => envio.resolve());
    expect(screen.getByRole('button', { name: /0 avisos pendentes/i })).toBeInTheDocument();
    expect(screen.queryByText('Popup 1')).not.toBeInTheDocument();
    await act(async () => consultaAntiga.resolve({ notificacoes: avisos }));
    await screen.findByRole('button', { name: /1 aviso pendente/i });
    expect(screen.getByText('Aviso novo')).toBeInTheDocument();
    expect(screen.getByText('Popup 3')).toBeInTheDocument();
    expect(screen.queryByText('Aviso antigo')).not.toBeInTheDocument();
    expect(listarNotificacoesUrgentes).toHaveBeenCalledTimes(3);
  });

  it('preserva lista e popup após falha e permite nova tentativa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    marcarTodasNotificacoesLidas.mockRejectedValueOnce(new Error('Falha simulada')).mockResolvedValueOnce(null);
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível marcar');
    expect(screen.getByText('Aviso antigo')).toBeInTheDocument();
    expect(screen.getByText('Popup 1')).toBeInTheDocument();
    listarNotificacoesUrgentes.mockResolvedValue({ notificacoes: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    await screen.findByRole('button', { name: /0 avisos pendentes/i });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Popup 1')).not.toBeInTheDocument();
    expect(marcarTodasNotificacoesLidas).toHaveBeenCalledTimes(2);
  });
});

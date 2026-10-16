import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoricoPage from './HistoricoPage';
import HistoricoLixeiraPage from './HistoricoLixeiraPage';
import { formatUtcDateTime } from '../../utils/datetime';
import { temPermissao } from '../../services/auth.service';
import { buscarVendaPorId } from '../../services/venda.service';

const log = {
  id: 1, acao: 'venda.atualizada', entidade: 'vendas', entidade_id: '42', metodo: 'PUT', rota: '/vendas/42',
  usuario_id: 7, usuario: { nome: 'Ana' }, created_at: '2026-10-01 15:00:00',
  dados: { alteracoes: { nome: 'Loja', data_venda: '2026-10-01' }, alteracoes_detalhadas: [
    { campo: 'data_venda', anterior: '2026-08-27', novo: '2026-10-01' }
  ] }
};
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/audit-log.service', () => ({
  listarAuditLogs: vi.fn(async () => ({ data: [log], total: 1 })),
  listarHistoricoVendasAgrupado: vi.fn(async () => ({ data: [log], total: 1 }))
}));
vi.mock('../../services/auth.service', () => ({ getUsuarioLocal: () => ({ id: 7 }), temPermissao: vi.fn(() => false) }));
vi.mock('../../services/config.service', () => ({
  listarEtapasFunil: vi.fn().mockResolvedValue([]), listarOperadoras: vi.fn().mockResolvedValue([]),
  listarServicos: vi.fn().mockResolvedValue([]), listarTiposVenda: vi.fn().mockResolvedValue([])
}));
vi.mock('../../services/cliente.service', () => ({ buscarClientePorId: vi.fn().mockResolvedValue({ id: 42 }), listarClientesSelect: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/venda.service', () => ({
  atualizarVenda: vi.fn(), buscarVendaPorId: vi.fn().mockResolvedValue({ id: 42 }), enviarVendaParaPosVenda: vi.fn(),
  listarVendedoras: vi.fn().mockResolvedValue([]), obterReferenciasClientesVendas: vi.fn().mockResolvedValue([])
}));
vi.mock('../VendasPage/VendaModal', () => ({ default: ({ onClose }) => <div role="dialog" aria-label="Venda"><button onClick={onClose}>Fechar venda</button></div> }));
vi.mock('../Clientes/ClienteModal', () => ({ default: ({ onClose }) => <div role="dialog" aria-label="Cliente"><button onClick={onClose}>Fechar cliente</button></div> }));

afterEach(() => {
  log.entidade = 'vendas';
  temPermissao.mockReturnValue(false);
});

function verificarDetalhes() {
  const card = screen.getByText('Detalhes do Registro').closest('.history-detail-card');
  const detalhes = within(card);
  expect(detalhes.getByText('Ana')).toBeInTheDocument();
  expect(detalhes.getByText(formatUtcDateTime(log.created_at))).toBeInTheDocument();
  expect(detalhes.getByText('27/08/2026')).toBeInTheDocument();
  expect(detalhes.getByText('01/10/2026')).toBeInTheDocument();
  expect(detalhes.getByText('Valor anterior')).toBeInTheDocument();
}

describe('Consulta de edições', () => {
  it('mostra a alteração efetiva com autor e horário no Histórico', async () => {
    const user = userEvent.setup();
    render(<HistoricoPage />);
    await user.click(await screen.findByText('Venda atualizada'));
    verificarDetalhes();
  });
  it('mostra os mesmos detalhes nas vendas da Lixeira', async () => {
    const user = userEvent.setup();
    render(<HistoricoLixeiraPage />);
    await user.click(await screen.findByTitle('Ver eventos'));
    await user.click(await screen.findByText('Venda atualizada'));
    verificarDetalhes();
  });

  it.each([['Histórico', HistoricoPage], ['Lixeira', HistoricoLixeiraPage]])('fecha por botão, Escape e fundo e restaura o foco na %s', async (_nome, Page) => {
    const user = userEvent.setup();
    render(<Page />);
    if (Page === HistoricoLixeiraPage) await user.click(await screen.findByTitle('Ver eventos'));
    const evento = (await screen.findByText('Venda atualizada')).closest('button, [role="button"]');
    for (const modo of ['botao', 'escape', 'fundo']) {
      await user.click(evento);
      const dialog = screen.getByRole('dialog', { name: 'Detalhes do Registro' });
      expect(dialog).toHaveAttribute('open');
      expect(document.body.style.overflow).toBe('hidden');
      expect(within(dialog).getByRole('button', { name: 'Fechar' })).toHaveFocus();
      await user.click(within(dialog).getByText('Valor anterior'));
      expect(dialog).toHaveAttribute('open');
      if (modo === 'botao') await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
      if (modo === 'escape') fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
      if (modo === 'fundo') await user.click(dialog);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');
      expect(evento).toHaveFocus();
    }
  });

  it('suspende os detalhes ao abrir venda e restaura o registro ao retornar', async () => {
    const user = userEvent.setup();
    render(<HistoricoPage />);
    const evento = (await screen.findByText('Venda atualizada')).closest('[role="button"]');
    evento.focus();
    await user.keyboard('{Enter}');
    verificarDetalhes();
    await user.click(screen.getByRole('button', { name: 'Abrir venda' }));
    expect(await screen.findByRole('dialog', { name: 'Venda' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Detalhes do Registro' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar venda' }));
    verificarDetalhes();
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(evento).toHaveFocus();
  });

  it('suspende o histórico ao abrir cliente e restaura ao fechar', async () => {
    log.entidade = 'clientes';
    temPermissao.mockReturnValue(true);
    const user = userEvent.setup();
    render(<HistoricoPage />);
    await user.click(await screen.findByText('Venda atualizada'));
    await user.click(screen.getByRole('button', { name: 'Abrir cliente' }));
    expect(await screen.findByRole('dialog', { name: 'Cliente' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Detalhes do Registro' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar cliente' }));
    verificarDetalhes();
    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
  });

  it('mantém o histórico aberto quando a venda não pode ser carregada', async () => {
    buscarVendaPorId.mockRejectedValueOnce(new Error('Falha ao carregar venda'));
    const user = userEvent.setup();
    render(<HistoricoPage />);
    await user.click(await screen.findByText('Venda atualizada'));
    await user.click(screen.getByRole('button', { name: 'Abrir venda' }));
    expect(await screen.findByText('Falha ao carregar venda')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Detalhes do Registro' })).toHaveAttribute('open');
  });
});

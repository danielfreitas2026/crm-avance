import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import HistoricoPage from './HistoricoPage';
import HistoricoLixeiraPage from './HistoricoLixeiraPage';
import { formatUtcDateTime } from '../../utils/datetime';

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
vi.mock('../../services/auth.service', () => ({ getUsuarioLocal: () => ({ id: 7 }), temPermissao: () => false }));
vi.mock('../../services/config.service', () => ({
  listarEtapasFunil: vi.fn().mockResolvedValue([]), listarOperadoras: vi.fn().mockResolvedValue([]),
  listarServicos: vi.fn().mockResolvedValue([]), listarTiposVenda: vi.fn().mockResolvedValue([])
}));
vi.mock('../../services/cliente.service', () => ({ buscarClientePorId: vi.fn(), listarClientesSelect: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/venda.service', () => ({
  atualizarVenda: vi.fn(), buscarVendaPorId: vi.fn(), enviarVendaParaPosVenda: vi.fn(),
  listarVendedoras: vi.fn().mockResolvedValue([]), obterReferenciasClientesVendas: vi.fn().mockResolvedValue([])
}));
vi.mock('../VendasPage/VendaModal', () => ({ default: () => null }));
vi.mock('../Clientes/ClienteModal', () => ({ default: () => null }));

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
});

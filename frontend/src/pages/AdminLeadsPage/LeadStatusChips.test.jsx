import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeadStatusChips } from './AdminLeadsPage';

vi.mock('../../services/lead-planilha.service', () => ({
  adminAtualizarCampoLead: vi.fn(),
  adminMarcarChamadaNaoAtendidaLead: vi.fn(),
  adminMarcarClienteRecusouLead: vi.fn(),
  adminMarcarRetornoLead: vi.fn(),
  adminMarcarVendaRecusadaLead: vi.fn(),
  adminReverterChamadaNaoAtendidaLead: vi.fn(),
  adminReverterClienteRecusouLead: vi.fn(),
  adminReverterFuturoClienteLead: vi.fn(),
  adminReverterVendaRecusadaLead: vi.fn(),
  atualizarLeadSchema: vi.fn(),
  criarLeadPlanilha: vi.fn(),
  dividirLeadLinhas: vi.fn(),
  excluirLeadPlanilha: vi.fn(),
  exportarLeadLinhas: vi.fn(),
  finalizarLeadPlanilha: vi.fn(),
  importarLeadPlanilhaExcel: vi.fn(),
  listarLeadLinhas: vi.fn(),
  listarLeadPlanilhas: vi.fn(),
  marcarErroLeadPlanilha: vi.fn(),
  salvarLeadLinhas: vi.fn()
}));

vi.mock('../../services/venda.service', () => ({ listarVendedoras: vi.fn() }));
vi.mock('../../services/cliente-antigo.service', () => ({ previewPlanilhaClientesAntigos: vi.fn() }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));

const LINHA_BASE = { id: 1, envio_id: 9 };

/**
 * Renderiza os chips de estado para uma linha de lead.
 */
function renderChips(linha = {}) {
  return render(<LeadStatusChips linha={{ ...LINHA_BASE, ...linha }} />);
}

describe('LeadStatusChips', () => {
  it('mostra o chip de chamada nao atendida quando o lead esta marcado', () => {
    renderChips({ chamada_nao_atendida: 1 });

    expect(screen.getByText('Chamada não atendida')).toBeVisible();
  });

  it('mostra o chip de cliente recusou quando o lead esta marcado', () => {
    renderChips({ cliente_recusou: 1 });

    expect(screen.getByText('Cliente recusou')).toBeVisible();
  });

  it('mantem o chip de chamada nao atendida apos a venda recusada ser revertida', () => {
    // Reverter zera os campos de venda recusada; a chamada nao atendida continua marcada.
    renderChips({
      venda_recusada_em: null,
      venda_recusada_motivo: null,
      chamada_nao_atendida: 1,
      chamada_nao_atendida_motivo: 'Ninguem atendeu.'
    });

    expect(screen.getByText('Chamada não atendida')).toBeVisible();
    expect(screen.queryByText('Venda recusada')).not.toBeInTheDocument();
  });

  it('acumula os chips quando o lead tem varios estados ativos', () => {
    renderChips({
      venda_recusada_em: '2026-07-16 14:30:00',
      cliente_recusou: 1,
      chamada_nao_atendida: 1
    });

    expect(screen.getByText('Venda recusada')).toBeVisible();
    expect(screen.getByText('Cliente recusou')).toBeVisible();
    expect(screen.getByText('Chamada não atendida')).toBeVisible();
  });

  it('expoe o motivo no title do chip', () => {
    renderChips({ chamada_nao_atendida: 1, chamada_nao_atendida_motivo: 'Caixa postal.' });

    expect(screen.getByText('Chamada não atendida')).toHaveAttribute('title', 'Motivo: Caixa postal.');
  });

  it('usa o rotulo do estado no title quando nao ha motivo', () => {
    renderChips({ chamada_nao_atendida: 1, chamada_nao_atendida_motivo: null });

    expect(screen.getByText('Chamada não atendida')).toHaveAttribute('title', 'Chamada não atendida');
  });

  it('nao mostra chips de recusa para um lead sem nenhuma marcacao', () => {
    renderChips();

    expect(screen.getByText('Enviado')).toBeVisible();
    expect(screen.queryByText('Chamada não atendida')).not.toBeInTheDocument();
    expect(screen.queryByText('Cliente recusou')).not.toBeInTheDocument();
    expect(screen.queryByText('Venda recusada')).not.toBeInTheDocument();
  });

  it('mostra "Não enviado" quando o lead nao foi distribuido', () => {
    render(<LeadStatusChips linha={{ id: 2 }} />);

    expect(screen.getByText('Não enviado')).toBeVisible();
  });

  it('mostra "Futuro cliente" para um lead qualificado, no lugar de "Qualificado venda"', () => {
    renderChips({ futuro_cliente: 1 });

    expect(screen.getByText('Futuro cliente')).toBeVisible();
    expect(screen.queryByText('Qualificado venda')).not.toBeInTheDocument();
  });

  it('mostra "Na lixeira" e nao "Futuro cliente" quando o futuro cliente foi excluido', () => {
    renderChips({ futuro_cliente: 1, futuro_cliente_excluido_em: '2026-07-16 14:30:00' });

    expect(screen.getByText('Na lixeira')).toBeVisible();
    expect(screen.queryByText('Futuro cliente')).not.toBeInTheDocument();
  });

  it('mostra "Retorno marcado" com a data no title quando ha retorno agendado', () => {
    renderChips({ retorno_agendado_em: '2026-07-20 13:00:00' });

    const chip = screen.getByText('Retorno marcado');
    expect(chip).toBeVisible();
    expect(chip.getAttribute('title')).toMatch(/^Retorno: /);
  });

  it.each([
    ['bom', 'Bom', 'quality-good'],
    ['mais_ou_menos', 'Mais ou menos', 'quality-medium'],
    ['ruim', 'Ruim', 'quality-bad']
  ])('mostra a qualidade %s da primeira ligacao', (valor, label, classe) => {
    renderChips({ primeira_ligacao_avaliacao: valor });

    const chip = screen.getByText(`1\u00aa liga\u00e7\u00e3o: ${label}`);
    expect(chip).toBeVisible();
    expect(chip).toHaveClass(classe);
    expect(chip).toHaveAttribute('title', `Qualidade da primeira liga\u00e7\u00e3o: ${label}`);
  });
});

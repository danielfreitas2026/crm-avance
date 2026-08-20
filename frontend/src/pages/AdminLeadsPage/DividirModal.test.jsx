import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DividirModal } from './AdminLeadsPage';
import { listarLeadLinhas } from '../../services/lead-planilha.service';

vi.mock('../../services/lead-planilha.service', () => ({
  adminMarcarChamadaNaoAtendidaLead: vi.fn(),
  adminMarcarClienteRecusouLead: vi.fn(),
  adminMarcarRetornoLead: vi.fn(),
  adminMarcarVendaRecusadaLead: vi.fn(),
  adminReverterChamadaNaoAtendidaLead: vi.fn(),
  adminReverterClienteRecusouLead: vi.fn(),
  adminReverterFuturoClienteLead: vi.fn(),
  adminReverterVendaRecusadaLead: vi.fn(),
  atualizarNomeLeadEnvio: vi.fn(),
  cancelarEnviosPlanilha: vi.fn(),
  atualizarLeadSchema: vi.fn(),
  criarLeadPlanilha: vi.fn(),
  dividirLeadLinhas: vi.fn(),
  excluirLeadPlanilha: vi.fn(),
  exportarLeadLinhas: vi.fn(),
  exportarLeadPlanilhaXlsx: vi.fn(),
  finalizarLeadPlanilha: vi.fn(),
  importarLeadPlanilhaExcel: vi.fn(),
  listarLeadLinhas: vi.fn(),
  listarDestinatariosEnviosPlanilha: vi.fn(),
  listarLeadPlanilhas: vi.fn(),
  marcarErroLeadPlanilha: vi.fn(),
  salvarLeadLinhas: vi.fn()
}));

vi.mock('../../services/venda.service', () => ({ listarVendedoras: vi.fn() }));
vi.mock('../../services/cliente-antigo.service', () => ({ previewPlanilhaClientesAntigos: vi.fn() }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));

const PROPS = {
  totalLinhas: 12,
  resumoLeads: { total: 12, enviados: 7, nao_enviados: 5 },
  colunas: [{ id: 'razao_social', label: 'Razão social' }],
  vendedoras: [{ id: 9, nome: 'Consultora Teste' }],
  filtrosDivisao: { planilha_ids: [1], busca: '', filters: [] },
  onClose: vi.fn(),
  onSave: vi.fn()
};

function renderModal(overrides = {}) {
  return render(<DividirModal {...PROPS} {...overrides} />);
}

describe('DividirModal - grupos de mailing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listarLeadLinhas.mockResolvedValue({ total: 5 });
    PROPS.onSave.mockResolvedValue({ requires_manual_allocation: false });
  });

  it('mostra todas as tags com os nomes exatos e inicia em Nao enviado', async () => {
    renderModal();

    await waitFor(() => expect(listarLeadLinhas).toHaveBeenCalledWith(expect.objectContaining({
      grupos_mailing: ['nao_enviado']
    })));
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(5));

    expect(screen.getByRole('checkbox', { name: /Não enviado/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Enviado/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Chamada não atendida/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Cliente recusou/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Retorno marcado/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Venda registrada/ })).not.toBeChecked();
  });

  it('combina grupos, atualiza a capacidade e envia somente o novo contrato', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ requires_manual_allocation: false });
    listarLeadLinhas
      .mockResolvedValueOnce({ total: 5 })
      .mockResolvedValueOnce({ total: 8 });
    renderModal({ onSave });

    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(5));
    await user.click(screen.getByRole('checkbox', { name: /Cliente recusou/ }));
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(8));
    await user.click(screen.getByRole('checkbox', { name: /Consultora Teste/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar mailing' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.grupos_mailing).toEqual(['nao_enviado', 'cliente_recusou']);
    expect(payload).not.toHaveProperty('incluir_enviados');
    expect(payload).not.toHaveProperty('status_reenvio');
    expect(payload).not.toHaveProperty('status_reenvio_modo');
  });

  it('seleciona todos, limpa a selecao e bloqueia o envio sem grupo', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox').filter(input => input.checked)).toHaveLength(6));

    await user.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    expect(screen.getByRole('button', { name: 'Enviar mailing' })).toBeDisabled();
    expect(screen.getByText('Selecione ao menos um grupo de mailing para continuar.')).toBeVisible();
  });
});

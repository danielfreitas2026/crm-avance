import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/lead-planilha.service', async () => {
  const original = await vi.importActual('../../services/lead-planilha.service');
  return {
    ...original,
    adminDesvincularVendaLead: vi.fn(),
    adminVincularVendaLead: vi.fn(),
    listarVendasCandidatasLead: vi.fn()
  };
});

import {
  adminDesvincularVendaLead,
  adminVincularVendaLead,
  listarVendasCandidatasLead
} from '../../services/lead-planilha.service';
import { VincularVendaFuturoClienteModal } from './FuturosClientesPage';

const vendaDisponivel = {
  id: 21,
  razao_social: 'Empresa Correta',
  data_venda: '2026-08-17',
  valor_total: 1500,
  status_funil_nome: 'Ativação',
  vendedores: [{ id: 3, nome: 'Consultora A' }],
  criador: { id: 4, nome: 'Gerente B' },
  disponivel: true,
  motivo_bloqueio: null
};

function resposta(vendas = [vendaDisponivel], vinculoAtual = null) {
  return {
    futuro_cliente_id: 8,
    cnpj: '12345678000190',
    cnpj_origem: 'sondagem',
    vinculo_atual: vinculoAtual,
    vendas
  };
}

describe('modal de vínculo manual de venda', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cobre carregamento, bloqueios e confirmação antes de vincular', async () => {
    let concluirBusca;
    listarVendasCandidatasLead.mockReturnValue(new Promise(resolve => { concluirBusca = resolve; }));
    adminVincularVendaLead.mockResolvedValue({ linha: { id: 8, venda_id: 21 } });
    const onAtualizado = vi.fn();
    const user = userEvent.setup();

    render(<VincularVendaFuturoClienteModal linha={{ id: 8 }} onClose={vi.fn()} onAtualizado={onAtualizado} />);
    expect(screen.getByText('Buscando vendas do mesmo CNPJ...')).toBeVisible();

    concluirBusca(resposta([
      vendaDisponivel,
      { ...vendaDisponivel, id: 22, disponivel: false, motivo_bloqueio: 'Venda cancelada' }
    ]));
    expect(await screen.findAllByText('Empresa Correta')).toHaveLength(2);
    expect(screen.getByText('Venda cancelada')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Selecionar venda' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Selecionar venda' }));
    expect(screen.getByText('Vincular a venda #21?')).toBeVisible();
    expect(adminVincularVendaLead).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(adminVincularVendaLead).toHaveBeenCalledWith(8, 21));
    expect(onAtualizado).toHaveBeenCalledWith({ id: 8, venda_id: 21 });
  });

  it('exibe lista vazia e erro de busca', async () => {
    listarVendasCandidatasLead.mockResolvedValueOnce(resposta([]));
    const { unmount } = render(<VincularVendaFuturoClienteModal linha={{ id: 8 }} onClose={vi.fn()} onAtualizado={vi.fn()} />);
    expect(await screen.findByText('Nenhuma venda não excluída foi encontrada para este CNPJ.')).toBeVisible();
    unmount();

    listarVendasCandidatasLead.mockRejectedValueOnce(new Error('Corrija o CNPJ antes da busca.'));
    render(<VincularVendaFuturoClienteModal linha={{ id: 9 }} onClose={vi.fn()} onAtualizado={vi.fn()} />);
    expect(await screen.findByText('Corrija o CNPJ antes da busca.')).toBeVisible();
  });

  it('desvincula somente após confirmação quando o vínculo é manual', async () => {
    listarVendasCandidatasLead.mockResolvedValue(resposta(
      [{ ...vendaDisponivel, disponivel: false, motivo_bloqueio: 'Ja vinculada ao futuro cliente #8' }],
      { venda: vendaDisponivel, manual: true, pode_desvincular: true }
    ));
    adminDesvincularVendaLead.mockResolvedValue({ linha: { id: 8, venda_id: null } });
    const user = userEvent.setup();

    render(<VincularVendaFuturoClienteModal linha={{ id: 8 }} onClose={vi.fn()} onAtualizado={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Desvincular venda' }));
    expect(screen.getByText('Confirmar desvínculo?')).toBeVisible();
    expect(adminDesvincularVendaLead).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(adminDesvincularVendaLead).toHaveBeenCalledWith(8));
  });

  it('explica por que vínculo direto não pode ser desfeito', async () => {
    listarVendasCandidatasLead.mockResolvedValue(resposta(
      [{ ...vendaDisponivel, disponivel: false, motivo_bloqueio: 'Ja vinculada ao futuro cliente #8' }],
      { venda: vendaDisponivel, manual: false, pode_desvincular: false }
    ));

    render(<VincularVendaFuturoClienteModal linha={{ id: 8 }} onClose={vi.fn()} onAtualizado={vi.fn()} />);
    expect(await screen.findByText(/veio do cadastro direto da venda/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Desvincular venda' })).not.toBeInTheDocument();
  });
});

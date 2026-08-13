import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as service from '../../services/lead-planilha.service';
import { LeadDetalheAdminModal } from './AdminLeadsPage';

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

const LINHA_BASE = {
  id: 1,
  envio_id: 9,
  dados_json: {
    'RAZAO SOCIAL': 'AUTO PECAS COLODETTI LTDA EPP',
    CNPJ: '31740517000140',
    ACESSOS: 1
  }
};

/**
 * Renderiza o modal com uma linha de lead, preenchendo o restante com a base.
 */
function renderModal(linha = {}) {
  const onClose = vi.fn();
  const onAtualizado = vi.fn();
  const utils = render(
    <LeadDetalheAdminModal linha={{ ...LINHA_BASE, ...linha }} onClose={onClose} onAtualizado={onAtualizado} />
  );
  return { ...utils, onClose, onAtualizado };
}

/**
 * Retorna o botao de gravacao do rodape.
 */
function botaoSalvar() {
  return screen.getByRole('button', { name: 'Salvar alterações' });
}

/**
 * Retorna o "Fechar" do rodape. O X do cabecalho tem o mesmo nome acessivel,
 * entao a busca precisa ser escopada ao rodape.
 */
function botaoFechar() {
  return within(document.querySelector('.modal-footer')).getByRole('button', { name: 'Fechar' });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Todas as acoes admin respondem a linha inteira relida; o modal usa a ultima.
  Object.values(service).forEach(fn => {
    if (vi.isMockFunction(fn)) fn.mockResolvedValue({ linha: { ...LINHA_BASE } });
  });
});

describe('LeadDetalheAdminModal - motivos das recusas', () => {
  it('exibe o motivo da venda recusada e do cliente recusou como texto visivel', () => {
    renderModal({
      venda_recusada_em: '2026-07-16 14:30:00',
      venda_recusada_motivo: 'Cliente achou o preco alto demais.',
      cliente_recusou: 1,
      cliente_recusou_em: '2026-07-16 15:00:00',
      cliente_recusou_motivo: 'Ja fechou com a concorrencia.'
    });

    expect(screen.getByText('Cliente achou o preco alto demais.')).toBeVisible();
    expect(screen.getByText('Ja fechou com a concorrencia.')).toBeVisible();
  });

  it('exibe a data em que a recusa foi marcada junto do rotulo', () => {
    renderModal({
      venda_recusada_em: '2026-07-16 14:30:00',
      venda_recusada_motivo: 'Sem interesse.'
    });

    expect(screen.getByText(/^Venda recusada · 16\/07\/26/)).toBeVisible();
  });

  it('usa o fallback quando a recusa nao tem motivo informado', () => {
    renderModal({
      chamada_nao_atendida: 1,
      chamada_nao_atendida_em: '2026-07-17 09:00:00',
      chamada_nao_atendida_motivo: null
    });

    expect(screen.getByText('Motivo não informado.')).toBeVisible();
  });

  it('nao renderiza a secao de motivos quando o lead nao tem nenhuma recusa', () => {
    renderModal();

    expect(screen.queryByText('Motivos')).not.toBeInTheDocument();
    expect(screen.queryByText('Motivo não informado.')).not.toBeInTheDocument();
  });

  it('mostra apenas os motivos dos estados ativos', () => {
    renderModal({
      cliente_recusou: 1,
      cliente_recusou_motivo: 'Motivo do cliente.'
    });

    expect(screen.getByText('Motivo do cliente.')).toBeVisible();
    expect(screen.queryByText(/^Venda recusada ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Chamada não atendida ·/)).not.toBeInTheDocument();
  });

  it('renderiza um motivo longo por completo', () => {
    const longo = 'A'.repeat(1000);
    renderModal({ venda_recusada_em: '2026-07-16 14:30:00', venda_recusada_motivo: longo });

    expect(screen.getByText(longo)).toBeVisible();
  });
});

describe('LeadDetalheAdminModal - dados da planilha sao somente leitura', () => {
  it('exibe os valores vindos da planilha', () => {
    renderModal();

    expect(screen.getByText('AUTO PECAS COLODETTI LTDA EPP')).toBeVisible();
    expect(screen.getByText('31740517000140')).toBeVisible();
  });

  it('nao transforma os valores da planilha em controles editaveis', async () => {
    renderModal();

    const valor = screen.getByText('AUTO PECAS COLODETTI LTDA EPP');
    expect(valor.tagName).toBe('SPAN');

    await userEvent.click(valor);

    expect(screen.queryByDisplayValue('AUTO PECAS COLODETTI LTDA EPP')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('prefere o valor atualizado e sinaliza a origem no rotulo', () => {
    renderModal({
      dados_json: { CNPJ: '31740517000140', 'CNPJ (atualizado)': '11222333000199' }
    });

    expect(screen.getByText('CNPJ (atualizado)')).toBeVisible();
    expect(screen.getByText('11222333000199')).toBeVisible();
    expect(screen.queryByText('31740517000140')).not.toBeInTheDocument();
  });
});

describe('LeadDetalheAdminModal - estados so gravam no "Salvar alteracoes"', () => {
  it('reverte futuro cliente apenas ao salvar e atualiza o chip de previa', async () => {
    renderModal({ futuro_cliente: 1, etapa_atual: 'sondagem', status_operacional: 'qualificado' });

    expect(screen.getByTitle('Futuro cliente')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Reverter futuro cliente' }));

    expect(service.adminReverterFuturoClienteLead).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Futuro cliente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manter futuro cliente' })).toBeVisible();

    await userEvent.click(botaoSalvar());
    expect(service.adminReverterFuturoClienteLead).toHaveBeenCalledWith(1);
    expect(service.adminReverterVendaRecusadaLead).not.toHaveBeenCalled();
  });

  it('permite desfazer a reversao no rascunho sem chamar a API', async () => {
    renderModal({ futuro_cliente: 1, etapa_atual: 'sondagem', status_operacional: 'qualificado' });

    await userEvent.click(screen.getByRole('button', { name: 'Reverter futuro cliente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Manter futuro cliente' }));

    expect(botaoSalvar()).toBeDisabled();
    expect(service.adminReverterFuturoClienteLead).not.toHaveBeenCalled();
  });

  it('nao oferece reversao para um lead comum', () => {
    renderModal({ futuro_cliente: 0 });

    expect(screen.queryByRole('button', { name: 'Reverter futuro cliente' })).not.toBeInTheDocument();
  });

  it.each([
    [{ futuro_cliente: 1, futuro_cliente_excluido_em: '2026-08-13 10:00:00' }, /lixeira/],
    [{ futuro_cliente: 1, etapa_atual: 'venda', status_operacional: 'distribuido_venda' }, /fluxo de venda/],
    [{ futuro_cliente: 1, venda_id: 42, status_operacional: 'vendido' }, /venda registrada/]
  ])('bloqueia a reversao em estados incompatíveis', (linha, mensagem) => {
    renderModal(linha);

    expect(screen.getByRole('button', { name: 'Reverter futuro cliente' })).toBeDisabled();
    expect(within(document.querySelector('.lead-detalhe-acao-bloqueada')).getByText(mensagem)).toBeVisible();
  });

  it('marcar um estado nao chama a API e ja reflete nos chips', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar chamada não atendida' }));

    expect(service.adminMarcarChamadaNaoAtendidaLead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reverter chamada não atendida' })).toBeVisible();
    expect(screen.getByText('Chamada não atendida')).toBeVisible();
  });

  it('o salvar nasce desabilitado e habilita apos uma alteracao', async () => {
    renderModal();

    expect(botaoSalvar()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar chamada não atendida' }));

    expect(botaoSalvar()).toBeEnabled();
    expect(screen.getByText('1 alteração não salva')).toBeVisible();
  });

  it('envia apenas as acoes que mudaram, sem no-op de reverter', async () => {
    renderModal({ chamada_nao_atendida: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'Reverter chamada não atendida' }));
    await userEvent.click(botaoSalvar());

    expect(service.adminReverterChamadaNaoAtendidaLead).toHaveBeenCalledWith(1);
    expect(service.adminReverterVendaRecusadaLead).not.toHaveBeenCalled();
    expect(service.adminReverterClienteRecusouLead).not.toHaveBeenCalled();
    expect(service.adminMarcarRetornoLead).not.toHaveBeenCalled();
  });

  it('exige o motivo da venda recusada antes de liberar o salvar', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar venda recusada' }));
    expect(botaoSalvar()).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Motivo da venda recusada (obrigatório)'), 'Preco alto.');
    expect(botaoSalvar()).toBeEnabled();

    await userEvent.click(botaoSalvar());
    expect(service.adminMarcarVendaRecusadaLead).toHaveBeenCalledWith(1, 'Preco alto.');
  });

  it('grava o retorno depois do cliente recusou, que zera o retorno no backend', async () => {
    const ordem = [];
    service.adminMarcarClienteRecusouLead.mockImplementation(() => {
      ordem.push('cliente-recusou');
      return Promise.resolve({ linha: { ...LINHA_BASE } });
    });
    service.adminMarcarRetornoLead.mockImplementation(() => {
      ordem.push('retorno');
      return Promise.resolve({ linha: { ...LINHA_BASE } });
    });

    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar cliente recusou' }));
    fireEvent.change(screen.getByLabelText('Retorno agendado'), { target: { value: '2026-07-20T10:00' } });
    await userEvent.click(botaoSalvar());

    expect(ordem).toEqual(['cliente-recusou', 'retorno']);
  });

  it('salva a observacao junto com a data de retorno', async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('Retorno agendado'), { target: { value: '2026-07-20T10:00' } });
    fireEvent.change(screen.getByLabelText('Observação para o retorno'), { target: { value: 'Falar com o financeiro' } });
    await userEvent.click(botaoSalvar());

    expect(service.adminMarcarRetornoLead).toHaveBeenCalledWith(
      LINHA_BASE.id,
      expect.any(String),
      'Falar com o financeiro'
    );
  });

  it('propaga apenas a ultima linha, uma vez, apos gravar o lote', async () => {
    const { onAtualizado } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar chamada não atendida' }));
    await userEvent.click(botaoSalvar());

    expect(onAtualizado).toHaveBeenCalledTimes(1);
  });
});

describe('LeadDetalheAdminModal - descarte de alteracoes pendentes', () => {
  it('fecha direto quando nao ha nada pendente', async () => {
    const { onClose } = renderModal();

    await userEvent.click(botaoFechar());

    expect(onClose).toHaveBeenCalled();
  });

  it('pede confirmacao ao fechar com alteracoes pendentes', async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar chamada não atendida' }));
    await userEvent.click(botaoFechar());

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Descartar alterações não salvas?')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('volta a edicao com o rascunho intacto ao continuar editando', async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar chamada não atendida' }));
    await userEvent.click(botaoFechar());
    await userEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reverter chamada não atendida' })).toBeVisible();
  });
});

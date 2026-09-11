import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AdminLeadsPage from './AdminLeadsPage';
import { listarHistoricoDestinatariosPlanilha, listarLeadLinhas, listarLeadPlanilhas } from '../../services/lead-planilha.service';
import { listarVendedoras } from '../../services/venda.service';
import { confirmarAberturaNotificacao } from '../../services/notificacao-abertura.service';

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
  listarHistoricoDestinatariosPlanilha: vi.fn(),
  listarLeadPlanilhas: vi.fn(),
  marcarErroLeadPlanilha: vi.fn(),
  salvarLeadLinhas: vi.fn()
}));

vi.mock('../../services/venda.service', () => ({ listarVendedoras: vi.fn() }));
vi.mock('../../services/cliente-antigo.service', () => ({ previewPlanilhaClientesAntigos: vi.fn() }));
vi.mock('../../services/notificacao-abertura.service', () => ({
  confirmarAberturaNotificacao: vi.fn().mockResolvedValue(true),
  falharAberturaNotificacao: vi.fn(),
  getNotificacaoIdParam: parametros => Number(parametros?.get('notificacao_id')) || null
}));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));

const PLANILHA = {
  id: 1,
  nome: 'Julho 24',
  status: 'concluida',
  total_linhas: 1,
  colunas: ['RAZAO SOCIAL'],
  schema_colunas: null
};

/**
 * Monta a resposta de listarLeadLinhas para uma unica linha.
 */
function respostaComLinha(linha) {
  return {
    data: [linha],
    total: 1,
    page: 1,
    page_size: 50,
    resumo: { total: 1, enviados: 1, qualificados: 0, nao_enviados: 0 }
  };
}

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={[`${window.location.pathname}${window.location.search}`]}>
      <AdminLeadsPage />
    </MemoryRouter>
  );
}

/**
 * Renderiza a pagina e seleciona a planilha, deixando a tabela visivel.
 */
async function abrirTabelaCom(linha) {
  listarLeadPlanilhas.mockResolvedValue([PLANILHA]);
  listarVendedoras.mockResolvedValue([]);
  listarLeadLinhas.mockResolvedValue(respostaComLinha(linha));

  renderPagina();

  const card = await screen.findByTitle('Julho 24');
  await userEvent.click(card);

  await waitFor(() => expect(listarLeadLinhas).toHaveBeenCalled());

  // A linha da tabela e clicavel e declara role="button", entao nao da para busca-la por role="row".
  const celula = await screen.findByText('AUTO PECAS COLODETTI LTDA EPP');
  return celula.closest('tr');
}

const LINHA_BASE = {
  id: 10,
  planilha_id: 1,
  planilha: { id: 1, nome: 'Julho 24' },
  envio_id: 9,
  envio: { id: 9, nome: 'Envio 16/07' },
  atribuidoPara: { id: 3, nome: 'Rayssa Carvalho' },
  dados_json: { 'RAZAO SOCIAL': 'AUTO PECAS COLODETTI LTDA EPP' }
};

describe('AdminLeadsPage - coluna Status da tabela', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/clientes-secretos');
  });

  it('abre diretamente um lead global recebido por notificacao', async () => {
    listarLeadPlanilhas.mockResolvedValue([]);
    listarVendedoras.mockResolvedValue([]);
    listarLeadLinhas.mockResolvedValue(respostaComLinha(LINHA_BASE));
    window.history.replaceState({}, '', '/clientes-secretos?notificacao_id=77&linha_id=10');

    renderPagina();

    expect(await screen.findByText('Detalhe do cliente')).toBeVisible();
    expect(listarLeadLinhas).toHaveBeenCalledWith({ linha_id: 10, page: 1, page_size: 1 });
    expect(confirmarAberturaNotificacao).toHaveBeenCalledWith(77);
  });

  it('abre o histórico do card sem selecionar a planilha', async () => {
    listarLeadPlanilhas.mockResolvedValue([PLANILHA]);
    listarVendedoras.mockResolvedValue([]);
    listarHistoricoDestinatariosPlanilha.mockResolvedValue({
      resumo: { pessoas: 0, atribuicoes: 0, clientes_unicos: 0, atualmente_atribuidos: 0 },
      pessoas: [],
      cobertura_historica: { aviso: 'Histórico legado pode estar incompleto.' }
    });

    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Ver histórico de Julho 24' }));

    expect(await screen.findByRole('dialog', { name: 'Quem já recebeu este mailing' })).toBeVisible();
    expect(listarHistoricoDestinatariosPlanilha).toHaveBeenCalledWith(1);
    expect(listarLeadLinhas).not.toHaveBeenCalled();
  });

  it('mostra "Chamada não atendida" na linha da tabela quando o lead esta marcado', async () => {
    const linha = await abrirTabelaCom({
      ...LINHA_BASE,
      chamada_nao_atendida: 1,
      chamada_nao_atendida_motivo: 'Ninguem atendeu.'
    });

    expect(within(linha).getByText('Chamada não atendida')).toBeVisible();
  });

  it('mostra "Cliente recusou" na linha da tabela quando o lead esta marcado', async () => {
    const linha = await abrirTabelaCom({
      ...LINHA_BASE,
      cliente_recusou: 1,
      cliente_recusou_motivo: 'Fechou com a concorrencia.'
    });

    expect(within(linha).getByText('Cliente recusou')).toBeVisible();
  });

  it('mostra na tabela os mesmos estados acumulados que o lead possui', async () => {
    const linha = await abrirTabelaCom({
      ...LINHA_BASE,
      venda_recusada_em: '2026-07-16 14:30:00',
      cliente_recusou: 1,
      chamada_nao_atendida: 1
    });

    expect(within(linha).getByText('Venda recusada')).toBeVisible();
    expect(within(linha).getByText('Cliente recusou')).toBeVisible();
    expect(within(linha).getByText('Chamada não atendida')).toBeVisible();
  });

  it('nao mostra chips de recusa para um lead sem marcacoes', async () => {
    const linha = await abrirTabelaCom({ ...LINHA_BASE });

    expect(within(linha).getByText('Enviado')).toBeVisible();
    expect(within(linha).queryByText('Chamada não atendida')).not.toBeInTheDocument();
    expect(within(linha).queryByText('Cliente recusou')).not.toBeInTheDocument();
  });
});

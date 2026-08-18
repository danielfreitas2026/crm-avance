import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

const api = vi.hoisted(() => ({
  getCampanhas: vi.fn(),
  getProgresso: vi.fn(),
  getRankingCampanha: vi.fn(),
  resgatarCampanha: vi.fn()
}));
const notificacoesApi = vi.hoisted(() => ({
  listarNotificacoes: vi.fn().mockResolvedValue({ notificacoes: [] }),
  marcarNotificacaoLida: vi.fn()
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/campanha.service', () => api);
vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 7, nome: 'Usuária Atual' }),
  temPermissao: (_usuario, permissao) => permissao === 'campanhas_visualizar'
}));
vi.mock('../../services/venda.service', () => ({
  buscarVendaPorId: vi.fn(), enviarVendaParaPosVenda: vi.fn(), listarVendedoras: vi.fn().mockResolvedValue([]),
  obterResumoVendas: vi.fn().mockResolvedValue({ vendasDia: 0, valorDia: 0, concluidasDia: 0, pipeline: 0, pipelineCount: 0, retornos: 0, perda: 0 })
}));
vi.mock('../../services/cliente.service', () => ({ buscarClientePorId: vi.fn() }));
vi.mock('../../services/config.service', () => ({
  listarEtapasFunil: vi.fn().mockResolvedValue([]), listarOperadoras: vi.fn().mockResolvedValue([]),
  listarServicos: vi.fn().mockResolvedValue([]), listarTiposVenda: vi.fn().mockResolvedValue([])
}));
vi.mock('../../services/notificacao.service', () => notificacoesApi);
vi.mock('../../services/dashboard.service', () => ({
  obterContextoNotificacoesDashboard: vi.fn().mockResolvedValue({ clientes: [], referencias_clientes: [], vendas_ativas_ids: [], vendas_retorno: [] })
}));
vi.mock('../Clientes/ClienteModal', () => ({ default: () => null }));
vi.mock('../VendasPage/VendaModal', () => ({ default: () => null }));

const campanha = {
  id: 12, is_gift: true, desc: 'Meta coletiva', categoria: 'venda', target: 10,
  data_inicio: '2026-08-01', data_fim: '2026-08-31', estado_periodo: 'ativa',
  participante_ids: [7, 8], participantes: [{ id: 7 }, { id: 8 }], operadoras: []
};

describe('DashboardPage - campanhas coletivas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCampanhas.mockResolvedValue([campanha]);
    api.getProgresso.mockResolvedValue({
      campanhas: { 12: { current: 6, target: 10, pct: 60, achieved: false, claimed: false, estado_periodo: 'ativa' } },
      campanhas_visiveis: [12], estados_campanhas: { 12: 'ativa' }, resgatadas: []
    });
    api.getRankingCampanha.mockResolvedValue({
      campanha: { ...campanha, current: 6, pct: 60, achieved: false, claimed: false, pode_resgatar: false },
      participantes: [
        { posicao: 1, id: 8, nome: 'Ana', email: 'ana@teste.com', contribuicao: 4, percentual_total: 66.67 },
        { posicao: 2, id: 7, nome: 'Usuária Atual', email: 'atual@teste.com', contribuicao: 2, percentual_total: 33.33 }
      ],
      vendas: [{
        id: 321, cliente_nome: 'Loja Exemplo', vendedora_nome: 'Ana', operadora_nome: 'Vivo',
        data_venda: '2026-08-10', valor_total: 349.9, contribuicao: 1, excecao: false
      }]
    });
  });

  it('mostra um card coletivo e abre o ranking no modal', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    const titulo = await screen.findByText('Meta coletiva');
    expect(screen.queryByText('Campanhas por usuário')).not.toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.classList?.contains('reward-numbers') && element.textContent.includes('6') && element.textContent.includes('10'))).toBeInTheDocument();

    await user.click(titulo);
    await waitFor(() => expect(api.getRankingCampanha).toHaveBeenCalledWith(12));
    expect(await screen.findByRole('dialog', { name: 'Meta coletiva' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Usuária Atual · Você')).toBeInTheDocument();
    expect(notificacoesApi.listarNotificacoes).toHaveBeenCalledWith({ escopo: 'dashboard' });
  });

  it('exibe as vendas contabilizadas em uma aba do modal', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByText('Meta coletiva'));
    await user.click(await screen.findByRole('tab', { name: /vendas 1/i }));

    expect(screen.getByRole('heading', { name: 'Vendas contabilizadas' })).toBeInTheDocument();
    expect(screen.getByText('Loja Exemplo')).toBeInTheDocument();
    expect(screen.getByText('Ana · Vivo')).toBeInTheDocument();
    expect(screen.getByText('#321')).toBeInTheDocument();
  });
});

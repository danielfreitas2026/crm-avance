import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FuturosClientesPage from './FuturosClientesPage';
import {
  exportarMetricasFuturosClientesExcel,
  listarEstatisticasFuturosClientes,
  listarEstatisticasLinhasMailing,
  listarEstatisticasMailingsUsuario
} from '../../services/lead-planilha.service';

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <main>{children}</main>
}));

vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 1, nome: 'Admin' }),
  temPermissao: () => true
}));

vi.mock('../../services/lead-planilha.service', async () => ({
  ...await vi.importActual('../../services/lead-planilha.service'),
  listarEstatisticasFuturosClientes: vi.fn(),
  listarEstatisticasMailingsUsuario: vi.fn(),
  listarEstatisticasLinhasMailing: vi.fn(),
  exportarMetricasFuturosClientesExcel: vi.fn()
}));

const indicadores = {
  recebidos: 120, trabalhados: 90, pendentes: 30, qualificados: 45,
  produtividade_pct: 75, qualificacao_pct: 50, conversao_pct: 20,
  tentativas_registradas: 105, retornos_agendados: 12, clientes_recusaram: 8,
  chamadas_nao_atendidas: 25, enviados_telegram: 30, aceitos_telegram: 22,
  recusados_expirados_telegram: 8, vendas_futuro_cliente: 9, vendas_antigas: 2,
  tempo_medio_primeira_acao_min: 60, potencial_mensal: 45000, valor_vendido: 9000
};
const usuario = { ...indicadores, usuario_id: 7, usuario_nome: 'Ana Consultora' };
const mailing = { ...indicadores, envio_id: 11, envio_nome: 'Mailing recente' };

function abrirPagina() {
  return render(<MemoryRouter initialEntries={['/futuros-clientes?aba=estatisticas']}><FuturosClientesPage /></MemoryRouter>);
}

function antesDe(primeiro, segundo) {
  expect(primeiro.compareDocumentPosition(segundo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

async function abrirUsuario() {
  await userEvent.click(await screen.findByRole('button', { name: 'Analisar desempenho de Ana Consultora' }));
  return screen.findByRole('region', { name: 'Mailings recebidos' });
}

async function abrirMailing() {
  await abrirUsuario();
  await userEvent.click(await screen.findByRole('button', { name: 'Analisar leads do mailing Mailing recente' }));
  return screen.findByRole('region', { name: 'Leads do mailing' });
}

describe('dashboard de estatísticas de futuros clientes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listarEstatisticasFuturosClientes.mockResolvedValue({ total: indicadores, usuarios: [usuario] });
    listarEstatisticasMailingsUsuario.mockResolvedValue([
      { ...mailing, envio_id: 5, envio_nome: 'Mailing antigo' }, mailing
    ]);
    listarEstatisticasLinhasMailing.mockResolvedValue({ data: [{ id: 101, tentativas_conhecidas: 3 }], total: 51 });
    exportarMetricasFuturosClientesExcel.mockResolvedValue(undefined);
  });

  it('prioriza indicadores e equipe, agrupando todas as métricas complementares abaixo', async () => {
    abrirPagina();
    const equipe = await screen.findByRole('region', { name: 'Desempenho por usuário' });
    const principais = screen.getByRole('region', { name: 'Indicadores principais' });
    const atividade = screen.getByRole('region', { name: 'Atividade registrada' });
    const telegram = screen.getByRole('region', { name: 'Telegram e vendas' });
    const comerciais = screen.getByRole('region', { name: 'Resultados comerciais' });
    antesDe(principais, equipe);
    antesDe(equipe, atividade);
    antesDe(atividade, comerciais);
    antesDe(telegram, comerciais);
    expect(within(principais).getAllByRole('article')).toHaveLength(4);
    expect(within(principais).getByText('75% de produtividade')).toBeVisible();
    for (const rotulo of ['Tentativas registradas', 'Retornos', 'Clientes que recusaram', 'Não atendidas']) {
      expect(within(atividade).getByText(rotulo)).toBeVisible();
    }
    for (const rotulo of ['Encaminhados pelo Telegram', 'Aceites no Telegram', 'Recusas/expirações', 'Vendas por futuro cliente', 'Vendas antigas']) {
      expect(within(telegram).getByText(rotulo)).toBeVisible();
    }
    expect(within(comerciais).getAllByRole('article')).toHaveLength(4);
    expect(within(comerciais).queryByText('Produtividade')).not.toBeInTheDocument();
    expect(within(comerciais).getByText('9.000,00', { exact: false })).toBeVisible();
    expect(within(equipe).getByText('75%')).toBeVisible();
    expect(within(equipe).getByText('20%')).toBeVisible();
  });

  it('prioriza os mailings no detalhe do usuário e mantém a ordem do mais recente', async () => {
    abrirPagina();
    const mailings = await abrirUsuario();
    antesDe(screen.getByRole('region', { name: 'Indicadores principais' }), mailings);
    antesDe(mailings, screen.getByRole('region', { name: 'Atividade registrada' }));
    const links = within(mailings).getAllByRole('button', { name: /Analisar leads do mailing/ });
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual([
      'Analisar leads do mailing Mailing recente', 'Analisar leads do mailing Mailing antigo'
    ]);
    expect(listarEstatisticasMailingsUsuario).toHaveBeenCalledWith(7, expect.objectContaining({ data_inicio: expect.any(String) }));
  });

  it('agrupa busca, leads e paginação e preserva os dois caminhos de retorno', async () => {
    abrirPagina();
    const painel = await abrirMailing();
    const caminho = screen.getByRole('navigation', { name: 'Navegação das estatísticas' });
    expect(within(caminho).getByText('Mailing recente')).toHaveAttribute('aria-current', 'page');
    expect(within(painel).getByRole('textbox', { name: 'Buscar lead neste mailing' })).toBeVisible();
    expect(within(painel).getByRole('table')).toBeVisible();
    expect(within(painel).getByText('Lead #101')).toBeVisible();
    expect(within(painel).getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await userEvent.click(within(painel).getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(7, 11, expect.objectContaining({ page: 2, page_size: 50 })));
    fireEvent.change(within(painel).getByRole('textbox'), { target: { value: 'Empresa' } });
    await waitFor(() => expect(listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(7, 11, expect.objectContaining({ busca: 'Empresa', page: 1 })));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(await screen.findByRole('region', { name: 'Mailings recebidos' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Analisar leads do mailing Mailing recente' }));
    await screen.findByRole('region', { name: 'Leads do mailing' });
    await userEvent.click(screen.getByRole('button', { name: 'Ana Consultora' }));
    await screen.findByRole('region', { name: 'Mailings recebidos' });
    await userEvent.click(screen.getByRole('button', { name: 'Todos os usuários' }));
    expect(await screen.findByRole('region', { name: 'Desempenho por usuário' })).toBeVisible();
  });

  it('mantém períodos e exportação com os mesmos filtros ao navegar', async () => {
    abrirPagina();
    await screen.findByRole('region', { name: 'Desempenho por usuário' });
    const user = userEvent.setup();
    const periodo = screen.getByRole('combobox', { name: 'Período' });
    await user.selectOptions(periodo, 'hoje');
    await waitFor(() => {
      const filtro = listarEstatisticasFuturosClientes.mock.lastCall[0];
      expect(filtro.data_inicio).toBe(filtro.data_fim);
    });
    await user.selectOptions(periodo, 'todos');
    await waitFor(() => expect(listarEstatisticasFuturosClientes).toHaveBeenLastCalledWith({}));
    await user.selectOptions(periodo, 'personalizado');
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-08-31' } });
    const filtro = { data_inicio: '2026-08-01', data_fim: '2026-08-31' };
    await waitFor(() => expect(listarEstatisticasFuturosClientes).toHaveBeenLastCalledWith(filtro));
    await abrirMailing();
    expect(listarEstatisticasMailingsUsuario).toHaveBeenLastCalledWith(7, filtro);
    expect(listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(7, 11, expect.objectContaining(filtro));
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(exportarMetricasFuturosClientesExcel).toHaveBeenCalledWith(filtro);
  });

  it('informa carregamento e erro sem exibir painéis com dados antigos', async () => {
    let rejeitar;
    listarEstatisticasFuturosClientes.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject; }));
    abrirPagina();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando indicadores...');
    expect(screen.getByRole('region', { name: 'Estatísticas de qualificação' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => rejeitar(new Error('Falha simulada')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha simulada');
    expect(screen.queryByRole('region', { name: 'Indicadores principais' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Período' }), 'todos');
    expect(await screen.findByRole('region', { name: 'Desempenho por usuário' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('apresenta indicadores zerados e estados vazios em todos os níveis', async () => {
    listarEstatisticasFuturosClientes.mockResolvedValueOnce({ total: {}, usuarios: [] });
    abrirPagina();
    expect(await screen.findByText('Nenhum usuário encontrado no período.')).toBeVisible();
    const principais = screen.getByRole('region', { name: 'Indicadores principais' });
    expect(within(principais).getAllByText('0', { exact: true })).toHaveLength(4);
    expect(within(principais).getByText('0% ainda aguardam ação')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Período' }), 'todos');
    listarEstatisticasMailingsUsuario.mockResolvedValueOnce([]);
    await abrirUsuario();
    expect(screen.getByText('Nenhum mailing encontrado no período.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Todos os usuários' }));
    listarEstatisticasLinhasMailing.mockResolvedValueOnce({ data: [], total: 0 });
    const painel = await abrirMailing();
    expect(within(painel).getByText('Nenhum lead encontrado.')).toBeVisible();
    expect(within(painel).getByText('Página 1 de 1')).toBeVisible();
    expect(within(painel).getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });
});

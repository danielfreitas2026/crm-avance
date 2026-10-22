import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EstatisticasFuturosClientesView } from './FuturosClientesPage';
import { obterPeriodoEstatisticas, formatarDataHoraEstatisticas } from './estatisticas-periodo';
import * as service from '../../services/lead-planilha.service';

vi.mock('../../services/lead-planilha.service', async importOriginal => ({
  ...await importOriginal(),
  listarEstatisticasFuturosClientes: vi.fn(),
  listarEstatisticasMailingsUsuario: vi.fn(),
  listarEstatisticasLinhasMailing: vi.fn(),
  exportarMetricasFuturosClientesExcel: vi.fn()
}));

function resumo(clientes = 4) {
  return { clientes_movimentados: clientes, futuros_clientes_adicionados: 2,
    novos_envios_telegram: 1, clientes_enviados_telegram: 3, vendas_registradas: 1, total_acoes: 8,
    valor_vendido: 100, acoes_por_tipo: { retorno_telegram: 2 } };
}
function raiz(clientes = 4) {
  return { total: resumo(clientes), usuarios: [
    { ...resumo(clientes), usuario_id: 7, usuario_nome: 'Qualificadora' }
  ] };
}
const mailing = { ...resumo(), envio_id: 100, envio_nome: 'Mailing antigo', ultima_movimentacao_em: '2025-02-10T12:00:00Z' };
function linhas(total = 1) {
  return { resumo: resumo(1), total, page: 1, page_size: 50, data: [{
    id: 1, dados_json: { 'Razão social': 'Loja antiga' }, ultima_movimentacao_em: '2025-02-10T12:00:00Z',
    movimentacoes_periodo: [{ id: 'retorno:1', titulo: 'Retorno ao Telegram',
      ocorrido_em: '2025-02-10T12:00:00Z', autor: { nome: 'Sistema' } }]
  }] };
}
function valor(rotulo) {
  const texto = screen.getAllByText(rotulo).find(item => item.closest('.future-stats__kpi'));
  return texto.closest('.future-stats__kpi').querySelector('strong').textContent;
}
async function abrirUsuario() {
  fireEvent.click(await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' }));
  await screen.findByRole('button', { name: 'Abrir mailing Mailing antigo' });
}
async function abrirMailing() {
  await abrirUsuario();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir mailing Mailing antigo' }));
  await screen.findByText('Loja antiga');
}

beforeEach(() => {
  vi.mocked(service.listarEstatisticasFuturosClientes).mockResolvedValue(raiz());
  vi.mocked(service.listarEstatisticasMailingsUsuario).mockResolvedValue({ resumo: resumo(10), data: [mailing] });
  vi.mocked(service.listarEstatisticasLinhasMailing).mockResolvedValue(linhas());
  vi.mocked(service.exportarMetricasFuturosClientesExcel).mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());

describe('estatísticas por movimentação', () => {
  it('agrupa cabeçalho e filtros e destaca a equipe antes das atividades', async () => {
    render(<EstatisticasFuturosClientesView />);
    const pessoa = await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    const painel = screen.getByRole('region', { name: 'Estatísticas de qualificação' });
    const periodo = screen.getByRole('combobox', { name: 'Período' });
    expect(screen.getByText('Ações realizadas no período, em qualquer mailing.')).toBeVisible();
    expect(periodo.closest('.future-stats__toolbar')).toContainElement(screen.getByRole('heading', { name: 'Todos os usuários' }));
    expect(painel.querySelectorAll('.future-stats__kpi-icon')).toHaveLength(4);
    expect(within(pessoa).getByText('Ver mailings e leads')).toBeVisible();
    const equipe = screen.getByRole('region', { name: 'Resultados por responsável pela qualificação' });
    const atividades = screen.getByRole('region', { name: 'Atividades no CRM' });
    expect(equipe.compareDocumentPosition(atividades) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('exibe os quadros de atividades apenas na visão geral, inclusive ao voltar do detalhe', async () => {
    render(<EstatisticasFuturosClientesView />);
    await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    function verificarAtividades(visiveis) {
      for (const nome of ['Atividades no CRM', 'Atividades no Telegram']) {
        const painel = screen.queryByRole('region', { name: nome });
        if (visiveis) expect(painel).toBeVisible();
        else expect(painel).not.toBeInTheDocument();
      }
    }
    verificarAtividades(true);
    await abrirUsuario();
    verificarAtividades(false);
    expect(valor('Clientes movimentados')).toBe('10');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'ontem' } });
    await screen.findByRole('button', { name: 'Abrir mailing Mailing antigo' });
    verificarAtividades(false);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mailing Mailing antigo' }));
    await screen.findByText('Loja antiga');
    verificarAtividades(false);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await screen.findByRole('button', { name: 'Abrir mailing Mailing antigo' });
    verificarAtividades(false);
    fireEvent.click(screen.getByRole('button', { name: 'Todos os usuários' }));
    await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    verificarAtividades(true);
  });

  it('mantém o detalhamento em tabelas identificadas e com rolagem própria', async () => {
    render(<EstatisticasFuturosClientesView />);
    await abrirUsuario();
    const mailings = screen.getByRole('region', { name: 'Tabela de mailings' });
    expect(mailings).toHaveAttribute('tabindex', '0');
    expect(within(mailings).getByRole('columnheader', { name: 'Clientes enviados ao Telegram' })).toBeVisible();
    expect(within(mailings).getByText('3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mailing Mailing antigo' }));
    const clientes = await screen.findByRole('region', { name: 'Clientes do mailing' });
    const tabela = within(clientes).getByRole('region', { name: 'Tabela de clientes' });
    expect(tabela).toHaveAttribute('tabindex', '0');
    expect(within(tabela).getByText('Loja antiga')).toBeVisible();
    expect(within(clientes).getByRole('button', { name: 'Próxima' }).closest('.future-stats__pagination')).not.toBeNull();
  });

  it('usa clientes enviados confirmados no indicador e na equipe, preservando o total de retornos', async () => {
    render(<EstatisticasFuturosClientesView />);
    await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    expect(valor('Clientes movimentados')).toBe('4');
    expect(valor('Futuros clientes adicionados')).toBe('2');
    expect(valor('Clientes enviados ao Telegram')).toBe('3');
    expect(screen.getByText('envio confirmado no período, sem repetir clientes')).toBeVisible();
    const pessoa = screen.getByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    expect(within(pessoa).getByText('Clientes enviados ao Telegram').nextElementSibling).toHaveTextContent('3');
    expect(screen.queryByText('Novos envios ao Telegram')).not.toBeInTheDocument();
    expect(valor('Vendas registradas')).toBe('1');
    expect(screen.getByText('Retornos ao Telegram').nextElementSibling).toHaveTextContent('2');
    expect(screen.queryByText('Produtividade')).not.toBeInTheDocument();
    expect(screen.queryByText('Conversão')).not.toBeInTheDocument();
  });

  it('trocar o período dentro do usuário atualiza o cabeçalho e mantém mailings antigos', async () => {
    const ontem = obterPeriodoEstatisticas('ontem');
    vi.mocked(service.listarEstatisticasMailingsUsuario).mockImplementation(async (id, periodo) => ({
      resumo: resumo(periodo.data_inicio === ontem.data_inicio ? 1 : 10), data: [mailing]
    }));
    render(<EstatisticasFuturosClientesView />);
    await abrirUsuario();
    expect(valor('Clientes movimentados')).toBe('10');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'ontem' } });
    await waitFor(() => expect(valor('Clientes movimentados')).toBe('1'));
    expect(service.listarEstatisticasMailingsUsuario).toHaveBeenLastCalledWith(7, ontem);
    expect(screen.getByRole('button', { name: 'Abrir mailing Mailing antigo' })).toBeVisible();
  });

  it('detalha data e autor, mantém paginação e reinicia a página quando o período muda', async () => {
    vi.mocked(service.listarEstatisticasLinhasMailing).mockResolvedValue(linhas(101));
    render(<EstatisticasFuturosClientesView />);
    await abrirMailing();
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Última movimentação no período')).toBeVisible();
    fireEvent.click(screen.getByText('Ver movimentações'));
    expect(within(tabela).getByText('Retorno ao Telegram')).toBeVisible();
    expect(within(tabela).getByText(/Sistema/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(service.listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(
      7, 100, expect.objectContaining({ page: 2 })
    ));
    await screen.findByText('Loja antiga');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'ontem' } });
    await waitFor(() => expect(service.listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(
      7, 100, expect.objectContaining({ ...obterPeriodoEstatisticas('ontem'), page: 1 })
    ));
    await screen.findByText('Loja antiga');
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar cliente neste mailing' }), { target: { value: 'loja' } });
    await waitFor(() => expect(service.listarEstatisticasLinhasMailing).toHaveBeenLastCalledWith(
      7, 100, expect.objectContaining({ busca: 'loja', page: 1 })
    ));
  });

  it('exporta o período e os escopos selecionados e permite voltar pela navegação', async () => {
    render(<EstatisticasFuturosClientesView />);
    await abrirMailing();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await waitFor(() => expect(service.exportarMetricasFuturosClientesExcel).toHaveBeenCalledWith({
      ...obterPeriodoEstatisticas('mes'), usuario_id: 7, envio_id: 100
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await screen.findByRole('button', { name: 'Abrir mailing Mailing antigo' });
    fireEvent.click(screen.getByRole('button', { name: 'Todos os usuários' }));
    await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    expect(valor('Clientes movimentados')).toBe('4');
  });

  it('ignora respostas antigas que chegam depois da mudança de período', async () => {
    let concluir;
    vi.mocked(service.listarEstatisticasFuturosClientes)
      .mockImplementationOnce(() => new Promise(resolve => { concluir = resolve; }))
      .mockResolvedValueOnce(raiz(1));
    render(<EstatisticasFuturosClientesView />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'ontem' } });
    await screen.findByRole('button', { name: 'Analisar desempenho de Qualificadora' });
    expect(valor('Clientes movimentados')).toBe('1');
    await act(async () => concluir(raiz(99)));
    expect(valor('Clientes movimentados')).toBe('1');
  });

  it('exibe ausência de movimento, aviso de legado e erros de período', async () => {
    vi.mocked(service.listarEstatisticasFuturosClientes).mockResolvedValueOnce({
      total: { ...resumo(0), historico_incompleto: true }, usuarios: []
    }).mockRejectedValueOnce(new Error('A data inicial deve ser anterior ou igual à data final.'));
    render(<EstatisticasFuturosClientesView />);
    await screen.findByText('Nenhuma movimentação encontrada no período.');
    expect(screen.getByRole('status')).toHaveTextContent('histórico antigo pode estar incompleto');
    expect(screen.getByRole('status')).toHaveTextContent('Envios antigos com confirmação e data entram na contagem');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'personalizado' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('A data inicial deve ser anterior ou igual à data final.');
  });
});

describe('atalhos no calendário de São Paulo', () => {
  it('exibe o mesmo fuso utilizado no filtro, inclusive para datas SQL sem timezone', () => {
    expect(formatarDataHoraEstatisticas('2025-03-01T02:59:59Z')).toContain('28/02/25');
    expect(formatarDataHoraEstatisticas('2025-03-01 02:59:59')).toContain('23:59');
    expect(formatarDataHoraEstatisticas(null)).toBe('-');
  });
  it('ontem respeita virada de dia, mês e ano', () => {
    expect(obterPeriodoEstatisticas('hoje', '', '', new Date('2025-03-01T02:59:59Z')))
      .toEqual({ data_inicio: '2025-02-28', data_fim: '2025-02-28' });
    expect(obterPeriodoEstatisticas('ontem', '', '', new Date('2025-03-01T03:00:00Z')))
      .toEqual({ data_inicio: '2025-02-28', data_fim: '2025-02-28' });
    expect(obterPeriodoEstatisticas('ontem', '', '', new Date('2025-01-01T12:00:00Z')))
      .toEqual({ data_inicio: '2024-12-31', data_fim: '2024-12-31' });
    expect(obterPeriodoEstatisticas('mes', '', '', new Date('2025-03-01T02:59:59Z')))
      .toEqual({ data_inicio: '2025-02-01', data_fim: '2025-02-28' });
  });
});

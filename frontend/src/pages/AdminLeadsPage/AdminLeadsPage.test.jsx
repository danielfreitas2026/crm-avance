import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AdminLeadsPage from './AdminLeadsPage';
import { dividirLeadLinhas, exportarLeadLinhas, listarHistoricoDestinatariosPlanilha, listarLeadLinhas, listarLeadPlanilhas } from '../../services/lead-planilha.service';
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

describe('AdminLeadsPage - filtros na seleção de planilhas', () => {
  const primeira = {
    ...PLANILHA,
    colunas: ['RAZAO SOCIAL', 'DATA', 'EXCLUSIVA'],
    schema_colunas: { DATA: 'date' }
  };
  const segunda = { ...primeira, id: 2, nome: 'Agosto 24', colunas: ['RAZAO SOCIAL', 'DATA'] };
  const terceira = { ...PLANILHA, id: 3, nome: 'Setembro 24', colunas: ['TELEFONE'] };
  const quarta = { ...segunda, id: 4, nome: 'Outubro 24' };
  let user;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/clientes-secretos');
    user = userEvent.setup({ delay: null });
    listarLeadPlanilhas.mockResolvedValue([primeira, segunda, terceira, quarta]);
    listarVendedoras.mockResolvedValue([{ id: 9, nome: 'Consultora Teste' }]);
    listarLeadLinhas.mockResolvedValue({
      data: [], total: 401,
      resumo: { total: 401, enviados: 0, qualificados: 0, nao_enviados: 401 }
    });
  });

  function controles() {
    const toolbar = within(document.querySelector('.admin-leads-toolbar'));
    const [coluna, operador] = toolbar.getAllByRole('combobox');
    return { toolbar, coluna, operador, valor: toolbar.getByPlaceholderText('Valor') };
  }

  async function abrir() {
    renderPagina();
    await user.click(await screen.findByTitle(primeira.nome));
    await esperarConsulta([1], []);
  }

  async function preencher(coluna, valor, op = 'contains', valor2 = '') {
    const campos = controles();
    fireEvent.change(campos.coluna, { target: { value: coluna } });
    fireEvent.change(campos.operador, { target: { value: op } });
    fireEvent.change(controles().valor, { target: { value: valor } });
    if (valor2) {
      const inputs = document.querySelectorAll('.admin-leads-toolbar input[type="date"]');
      fireEvent.change(inputs[1], { target: { value: valor2 } });
    }
  }

  async function adicionar(coluna, valor, op = 'contains', valor2 = '') {
    await preencher(coluna, valor, op, valor2);
    await user.click(screen.getByRole('button', { name: 'Adicionar filtro' }));
  }

  async function esperarConsulta(ids, filters, page = 1) {
    await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.objectContaining({
      planilha_ids: ids, page, filters: JSON.stringify(filters)
    })));
  }

  function filtro(coluna, valor, planilha_id = 1, op = 'contains', tipo = 'string', valor2 = '') {
    return { coluna, planilha_id, tipo, op, valor, valor2 };
  }

  it('preserva filtro e rascunho ao adicionar planilha sem colunas comuns e volta à primeira página', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja', 'exact');
    await preencher('1::EXCLUSIVA', 'rascunho', 'starts');
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await esperarConsulta([1], [filtro('RAZAO SOCIAL', 'Loja', 1, 'exact')], 2);

    await user.click(screen.getByTitle(terceira.nome));

    await esperarConsulta([1, 3], [filtro('RAZAO SOCIAL', 'Loja', 1, 'exact')]);
    expect(screen.getByRole('button', { name: 'RAZAO SOCIAL: Loja x' })).toBeVisible();
    expect(controles().coluna).toHaveValue('1::EXCLUSIVA');
    expect(controles().operador).toHaveValue('starts');
    expect(controles().valor).toHaveValue('rascunho');
  });

  it('mescla filtros e rascunho, preserva intervalo e usa os mesmos filtros na exportação e divisão', async () => {
    await abrir();
    await adicionar('1::DATA', '2026-10-01', 'between', '2026-10-19');
    await preencher('1::RAZAO SOCIAL', 'Loja', 'starts');
    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));

    const filters = [filtro('DATA', '2026-10-01', null, 'between', 'date', '2026-10-19')];
    await esperarConsulta([1, 2], filters);
    expect(screen.getByRole('button', { name: 'DATA: 2026-10-01 até 2026-10-19 x' })).toBeVisible();
    expect(controles().coluna).toHaveValue('merge::razao social');
    expect(controles().operador).toHaveValue('starts');
    expect(controles().valor).toHaveValue('Loja');

    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mailing');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportarLeadLinhas.mockResolvedValue(new Blob(['csv']));
    try {
      await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
      expect(exportarLeadLinhas).toHaveBeenCalledWith(expect.objectContaining({ planilha_ids: [1, 2], filters }));
      await user.click(screen.getByRole('button', { name: 'Dividir clientes' }));
      await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.objectContaining({
        planilha_ids: [1, 2], filters: JSON.stringify(filters), grupos_mailing: ['nao_enviado']
      })));
      dividirLeadLinhas.mockResolvedValue({ requires_manual_allocation: false });
      await user.click(screen.getByRole('checkbox', { name: /Consultora Teste/ }));
      await user.click(screen.getByRole('button', { name: 'Enviar mailing' }));
      await waitFor(() => expect(dividirLeadLinhas).toHaveBeenCalledWith(expect.objectContaining({
        filtros: expect.objectContaining({ planilha_ids: [1, 2], filters })
      })));
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      clickLink.mockRestore();
    }
  });

  it('mantém o filtro na planilha original quando as colunas continuam separadas', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja', 'ends');
    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Separar todas' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));

    await esperarConsulta([1, 2], [filtro('RAZAO SOCIAL', 'Loja', 1, 'ends')]);
    expect(screen.getByRole('button', { name: 'RAZAO SOCIAL - Julho 24: Loja x' })).toBeVisible();
    expect(controles().coluna).toHaveValue('1::RAZAO SOCIAL');
  });

  it('reconcilia a coluna mesclada com a única origem restante ao desmarcar planilha', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));
    await esperarConsulta([1, 2], [filtro('RAZAO SOCIAL', 'Loja', null)]);

    await user.click(screen.getByTitle(primeira.nome));

    await esperarConsulta([2], [filtro('RAZAO SOCIAL', 'Loja', 2)]);
    expect(controles().coluna).toHaveValue('2::RAZAO SOCIAL');
    expect(screen.getByRole('button', { name: 'RAZAO SOCIAL: Loja x' })).toBeVisible();
  });

  it('remove apenas filtros sem origem restante e avisa, sem transferir para coluna de mesmo nome', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Separar todas' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));
    await adicionar('2::DATA', '2026-10-19', 'exact');
    await preencher('2::RAZAO SOCIAL', 'rascunho');

    await user.click(screen.getByTitle(primeira.nome));

    await esperarConsulta([2], [filtro('DATA', '2026-10-19', 2, 'exact', 'date')]);
    expect(screen.queryByRole('button', { name: /Loja x/ })).not.toBeInTheDocument();
    expect(controles().coluna).toHaveValue('2::RAZAO SOCIAL');
    expect(controles().valor).toHaveValue('rascunho');
    expect(screen.getByText(/Filtros sem coluna de destino única foram removidos/)).toBeVisible();
  });

  it('descarta filtros e rascunho ambíguos ao separar mesclagens e preserva os demais', async () => {
    await abrir();
    await adicionar('1::EXCLUSIVA', 'único');
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));
    await preencher('merge::razao social', 'rascunho');
    await user.click(screen.getByTitle(quarta.nome));
    await user.click(screen.getByRole('button', { name: 'Separar todas' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar selecao' }));

    await esperarConsulta([1, 2, 4], [filtro('EXCLUSIVA', 'único')]);
    expect(controles().coluna).toHaveValue('');
    expect(controles().valor).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Loja x/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Filtros sem coluna de destino única foram removidos/)).toBeVisible();
  });

  it('cancelar mesclagem mantém filtros, rascunho, seleção e página anteriores', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await preencher('1::EXCLUSIVA', 'rascunho');
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await esperarConsulta([1], [filtro('RAZAO SOCIAL', 'Loja')], 2);
    const chamadas = listarLeadLinhas.mock.calls.length;

    await user.click(screen.getByTitle(segunda.nome));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(listarLeadLinhas).toHaveBeenCalledTimes(chamadas);
    expect(screen.getByText('Página 2 de 3')).toBeVisible();
    expect(screen.getByRole('button', { name: 'RAZAO SOCIAL: Loja x' })).toBeVisible();
    expect(controles().valor).toHaveValue('rascunho');
    expect(screen.getByTitle(segunda.nome).closest('.lead-doc-card')).not.toHaveClass('active');
  });

  it('limpa filtros e rascunho ao desmarcar a última planilha ou limpar a seleção com Escape', async () => {
    await abrir();
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await user.click(screen.getByTitle(primeira.nome));
    expect(screen.queryByRole('button', { name: /Loja x/ })).not.toBeInTheDocument();
    expect(controles().coluna).toHaveValue('');
    expect(screen.getByText('0 registros encontrados')).toBeVisible();

    await user.click(screen.getByTitle(primeira.nome));
    await adicionar('1::RAZAO SOCIAL', 'Loja');
    await preencher('1::EXCLUSIVA', 'rascunho');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Loja x/ })).not.toBeInTheDocument();
    expect(controles().valor).toHaveValue('');
    expect(screen.getByTitle(primeira.nome).closest('.lead-doc-card')).not.toHaveClass('active');
  });
});

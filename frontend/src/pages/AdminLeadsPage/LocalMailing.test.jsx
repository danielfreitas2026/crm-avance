import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocalMailingModal } from './LocalMailing';
import AdminLeadsPage from './AdminLeadsPage';
import { buscarLeadPlanilhaStatus, dividirLeadLinhas, exportarLeadLinhas, listarLeadLinhas, listarLeadPlanilhas, listarLocaisMailing, preencherLocalMailing } from '../../services/lead-planilha.service';
import { listarVendedoras } from '../../services/venda.service';

vi.mock('../../services/lead-planilha.service', async importOriginal => ({
  ...await importOriginal(),
  buscarLeadPlanilhaStatus: vi.fn(), dividirLeadLinhas: vi.fn(), exportarLeadLinhas: vi.fn(),
  listarLeadLinhas: vi.fn(), listarLeadPlanilhas: vi.fn(), listarLocaisMailing: vi.fn(), preencherLocalMailing: vi.fn()
}));
vi.mock('../../services/venda.service', () => ({ listarVendedoras: vi.fn() }));
vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));

const PLANILHA = { id: 1, nome: 'Mailing Local', status: 'concluida', total_linhas: 2, colunas: ['Empresa', 'Terminal', 'Fixo'], schema_colunas: {} };
const CONFIG = { campos: ['Terminal', 'Fixo'], coluna: 'Local', status: 'concluido', processadas: 2, identificadas: 1, total: 2 };
const LOCAIS = [
  { ddd: '19', label: 'Campinas e região/SP — DDD 19' },
  { ddd: '21', label: 'Rio de Janeiro e região/RJ — DDD 21' }
];

beforeEach(() => {
  vi.clearAllMocks();
  listarLeadPlanilhas.mockResolvedValue([PLANILHA]);
  listarVendedoras.mockResolvedValue([{ id: 9, nome: 'Consultora Teste' }]);
  listarLeadLinhas.mockResolvedValue({ data: [], total: 2, resumo: { total: 2, nao_enviados: 2, enviados: 0, qualificados: 0 } });
  listarLocaisMailing.mockResolvedValue(LOCAIS);
  dividirLeadLinhas.mockResolvedValue({});
});

describe('configuração manual do Local', () => {
  it('atualiza o contador ao selecionar e desmarcar campos pelo rótulo', async () => {
    const user = userEvent.setup();
    render(<LocalMailingModal planilha={PLANILHA} onClose={vi.fn()} onIniciado={vi.fn()} />);
    const contador = screen.getByRole('status');
    expect(contador).toHaveTextContent('0 selecionados');
    expect(screen.queryByText(/Ao repetir/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Terminal', { exact: true }));
    expect(screen.getByRole('checkbox', { name: 'Terminal' })).toBeChecked();
    expect(contador).toHaveTextContent('1 selecionado');
    await user.click(screen.getByText('Fixo', { exact: true }));
    expect(contador).toHaveTextContent('2 selecionados');
    await user.click(screen.getByText('Terminal', { exact: true }));
    expect(contador).toHaveTextContent('1 selecionado');
    await user.click(screen.getByText('Fixo', { exact: true }));
    expect(contador).toHaveTextContent('0 selecionados');
    expect(screen.getByRole('button', { name: 'Preencher Local', exact: true })).toBeDisabled();
  });

  it.each(['Fechar localização', 'Cancelar'])('fecha por %s e devolve o foco ao acionador', async nome => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onIniciado = vi.fn();
    const { rerender } = render(<><button type="button">Abrir localização</button></>);
    const acionador = screen.getByRole('button', { name: 'Abrir localização' });
    await user.click(acionador);
    rerender(<><button type="button">Abrir localização</button><LocalMailingModal planilha={PLANILHA} onClose={onClose} onIniciado={onIniciado} /></>);
    expect(screen.getByRole('button', { name: 'Fechar localização' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: nome }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onIniciado).not.toHaveBeenCalled();
    expect(preencherLocalMailing).not.toHaveBeenCalled();
    rerender(<><button type="button">Abrir localização</button></>);
    expect(acionador).toHaveFocus();
  });

  it('bloqueia os controles e o Escape enquanto inicia o preenchimento', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onIniciado = vi.fn();
    let concluir;
    preencherLocalMailing.mockReturnValueOnce(new Promise(resolve => { concluir = resolve; }));
    render(<LocalMailingModal planilha={{ ...PLANILHA, local_config: CONFIG }} onClose={onClose} onIniciado={onIniciado} />);
    const modal = screen.getByRole('dialog', { name: 'Preencher Local por DDD' });
    expect(screen.getByRole('status')).toHaveTextContent('2 selecionados');
    expect(screen.getByText(/Ao repetir/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Preencher Local', exact: true }));
    expect(screen.getByRole('button', { name: 'Iniciando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fechar localização' })).toBeDisabled();
    for (const campo of screen.getAllByRole('checkbox')) expect(campo).toBeDisabled();
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    concluir({ ...PLANILHA, local_config: CONFIG });
    await waitFor(() => expect(onIniciado).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('fecha pelo cancelamento nativo quando não está processando', () => {
    const onClose = vi.fn();
    render(<LocalMailingModal planilha={PLANILHA} onClose={onClose} onIniciado={vi.fn()} />);
    fireEvent(screen.getByRole('dialog', { name: 'Preencher Local por DDD' }), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('seleciona vários campos e preserva o modal em caso de erro', async () => {
    const user = userEvent.setup();
    const onIniciado = vi.fn();
    const onClose = vi.fn();
    preencherLocalMailing.mockRejectedValueOnce(new Error('Planilha já está sendo processada.'));
    preencherLocalMailing.mockResolvedValueOnce({ ...PLANILHA, local_config: CONFIG });
    render(<LocalMailingModal planilha={PLANILHA} onClose={onClose} onIniciado={onIniciado} />);
    expect(screen.getByRole('button', { name: 'Preencher Local', exact: true })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Terminal' }));
    await user.click(screen.getByRole('checkbox', { name: 'Fixo' }));
    await user.click(screen.getByRole('button', { name: 'Preencher Local', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('já está sendo processada');
    expect(onClose).not.toHaveBeenCalled();
    expect(preencherLocalMailing).toHaveBeenLastCalledWith(1, ['Terminal', 'Fixo']);
    await user.click(screen.getByRole('button', { name: 'Preencher Local', exact: true }));
    expect(onIniciado).toHaveBeenCalledWith(expect.objectContaining({ local_config: CONFIG }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restaura configuração sem oferecer a coluna gerada ou campos atualizados', () => {
    render(<LocalMailingModal planilha={{ ...PLANILHA, colunas: [...PLANILHA.colunas, 'Local', 'Fixo (atualizado)'], local_config: CONFIG }} onClose={vi.fn()} onIniciado={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Terminal' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fixo' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Local' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Fixo (atualizado)' })).not.toBeInTheDocument();
  });
});

function renderPagina() {
  render(<MemoryRouter><AdminLeadsPage /></MemoryRouter>);
}

describe('Local na tela de mailing', () => {
  it('inicia sem selecionar o card, mostra progresso e atualiza colunas mantendo seleção e busca', async () => {
    const user = userEvent.setup({ delay: null });
    const processando = { ...PLANILHA, colunas: [...PLANILHA.colunas, 'Local'], local_config: { ...CONFIG, status: 'processando', processadas: 0 } };
    preencherLocalMailing.mockResolvedValue(processando);
    buscarLeadPlanilhaStatus.mockResolvedValue({ ...processando, local_config: CONFIG });
    renderPagina();
    const abrirLocal = await screen.findByRole('button', { name: `Preencher Local por DDD de ${PLANILHA.nome}` });
    abrirLocal.focus();
    await user.keyboard('{Enter}');
    expect(listarLeadLinhas).not.toHaveBeenCalled();
    const modal = screen.getByRole('dialog', { name: 'Preencher Local por DDD' });
    await user.click(within(modal).getByRole('checkbox', { name: 'Terminal' }));
    await user.click(within(modal).getByRole('checkbox', { name: 'Fixo' }));
    await user.click(within(modal).getByRole('button', { name: 'Preencher Local', exact: true }));
    expect(await screen.findByText(/Local: 0\/2 linhas/)).toBeVisible();
    await user.click(screen.getByTitle(PLANILHA.nome));
    fireEvent.change(screen.getByPlaceholderText('Buscar em todas as colunas'), { target: { value: 'Loja' } });
    await waitFor(() => expect(buscarLeadPlanilhaStatus).toHaveBeenCalledWith('1'), { timeout: 3000 });
    expect(await screen.findByText('Local: 1/2 identificadas')).toBeVisible();
    expect(await screen.findByRole('columnheader', { name: 'Local', exact: true })).toBeVisible();
    expect(screen.getByPlaceholderText('Buscar em todas as colunas')).toHaveValue('Loja');
    await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.objectContaining({ planilha_ids: [1], busca: 'Loja' })));
  });

  it('usa todas as áreas selecionadas na consulta, exportação e divisão', async () => {
    const user = userEvent.setup({ delay: null });
    listarLeadPlanilhas.mockResolvedValue([{ ...PLANILHA, local_config: CONFIG }]);
    renderPagina();
    await user.click(await screen.findByTitle(PLANILHA.nome));
    await user.click(screen.getByText('Local/DDD', { exact: true }));
    await user.click(await screen.findByRole('checkbox', { name: LOCAIS[0].label }));
    await user.click(screen.getByRole('checkbox', { name: LOCAIS[1].label }));
    await user.click(screen.getByRole('checkbox', { name: 'Não identificado' }));
    const filtros = { local_ddds: ['19', '21'], local_nao_identificado: true };
    await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.objectContaining({ ...filtros, page: 1 })));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickLink = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportarLeadLinhas.mockResolvedValue(new Blob(['csv']));
    try {
      await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
      expect(exportarLeadLinhas).toHaveBeenCalledWith(expect.objectContaining(filtros));
      await user.click(screen.getByRole('button', { name: 'Dividir clientes' }));
      await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.objectContaining({ ...filtros, grupos_mailing: ['nao_enviado'] })));
      await user.click(screen.getByRole('checkbox', { name: /Consultora Teste/ }));
      await user.click(screen.getByRole('button', { name: 'Enviar mailing' }));
      await waitFor(() => expect(dividirLeadLinhas).toHaveBeenCalledWith(expect.objectContaining({ filtros: expect.objectContaining(filtros) })));
    } finally { createUrl.mockRestore(); revokeUrl.mockRestore(); clickLink.mockRestore(); }
  });

  it('busca áreas pelo nome sem acento e bloqueia filtros de planilhas não processadas', async () => {
    const user = userEvent.setup({ delay: null });
    renderPagina();
    await user.click(await screen.findByTitle(PLANILHA.nome));
    await user.click(screen.getByText('Local/DDD', { exact: true }));
    await screen.findByRole('checkbox', { name: LOCAIS[0].label });
    await user.type(screen.getByRole('textbox', { name: 'Buscar área ou DDD' }), 'regiao/SP');
    expect(screen.queryByRole('checkbox', { name: LOCAIS[1].label })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: LOCAIS[0].label }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Conclua ou repita');
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dividir clientes' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
    expect(listarLeadLinhas.mock.calls.every(([filtros]) => !filtros.local_ddds)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Limpar Local/DDD' }));
    await waitFor(() => expect(listarLeadLinhas).toHaveBeenLastCalledWith(expect.not.objectContaining({ local_ddds: ['19'] })));
  });

  it('mostra falhas e resultados parciais permitindo novo preenchimento', async () => {
    listarLeadPlanilhas.mockResolvedValue([{ ...PLANILHA, local_config: { ...CONFIG, status: 'erro', erro: 'Preenchimento interrompido. Os resultados são parciais; repita o preenchimento.', processadas: 1 } }]);
    renderPagina();
    expect(await screen.findByText(/Preenchimento interrompido/)).toHaveTextContent('1/2 linhas processadas');
    expect(screen.getByRole('button', { name: `Preencher Local por DDD de ${PLANILHA.nome}` })).toBeEnabled();
  });

  it('informa falha da exportação quando o servidor detecta Local incompleto', async () => {
    const user = userEvent.setup({ delay: null });
    exportarLeadLinhas.mockRejectedValue(new Error('Conclua ou repita o preenchimento de Local.'));
    renderPagina();
    await user.click(await screen.findByTitle(PLANILHA.nome));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(await screen.findByText('Conclua ou repita o preenchimento de Local.')).toBeVisible();
  });
});

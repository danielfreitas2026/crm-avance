import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VendasPage from './VendasPage';

const api = vi.hoisted(() => ({
  listarVendas: vi.fn(),
  buscarVendaPorId: vi.fn(),
  obterReferenciasClientesVendas: vi.fn(),
  listarVendedoras: vi.fn(),
  listarDestinatariosProblemaVenda: vi.fn(),
  listarOperadoras: vi.fn(),
  listarServicos: vi.fn(),
  listarTiposVenda: vi.fn(),
  listarEtapasFunil: vi.fn(),
  listarClientesSelect: vi.fn(),
  criarVenda: vi.fn()
}));

vi.mock('../../utils/useDebounce', () => ({ useDebounce: value => value }));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <main>{children}</main>
}));

vi.mock('./VendaModal', () => ({
  default: ({ venda, initialValues, initialTab, clientePreenchido, modoEdicao, onSave, onClose, onTabChange }) => (
    <section role="dialog" aria-label="modal venda">
      {venda?.nome || initialValues?.nome || 'Nova venda'}
      <span>{clientePreenchido?.nome || ''}</span>
      <output>edição:{String(modoEdicao)}</output>
      <output>aba:{initialTab}</output>
      <button type="button" onClick={() => onTabChange('arquivos')}>Abrir documentos simulados</button>
      <button type="button" onClick={onClose}>Fechar detalhe</button>
      <button type="button" onClick={() => onSave(initialValues)}>Salvar venda simulada</button>
    </section>
  )
}));

vi.mock('../Clientes/ClienteModal', () => ({ default: () => null }));

vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: () => ({ id: 1, nome: 'Admin' }),
  temPermissao: () => true
}));

vi.mock('../../services/venda.service', () => ({
  atualizarVenda: vi.fn(),
  baixarXlsxClaro: vi.fn(),
  buscarVendaPorId: api.buscarVendaPorId,
  criarVenda: api.criarVenda,
  deletarVenda: vi.fn(),
  enviarVendaParaPosVenda: vi.fn(),
  excluirReversaoVenda: vi.fn(),
  exportarVendasExcel: vi.fn(),
  gerarEmailVenda: vi.fn(),
  listarDestinatariosProblemaVenda: api.listarDestinatariosProblemaVenda,
  listarVendas: api.listarVendas,
  listarVendedoras: api.listarVendedoras,
  marcarProblemaVenda: vi.fn(),
  obterReferenciasClientesVendas: api.obterReferenciasClientesVendas,
  registrarReversaoVenda: vi.fn(),
  reenviarVendaParaDashboard: vi.fn(),
  uploadArquivoVenda: vi.fn()
}));

vi.mock('../../services/config.service', () => ({
  listarEtapasFunil: api.listarEtapasFunil,
  listarOperadoras: api.listarOperadoras,
  listarServicos: api.listarServicos,
  listarTiposVenda: api.listarTiposVenda
}));

vi.mock('../../services/cliente.service', () => ({
  criarCliente: vi.fn(),
  listarClientesSelect: api.listarClientesSelect,
  verificarDocumentoCliente: vi.fn()
}));

vi.mock('../../services/nota.service', () => ({ criarNotaEntidade: vi.fn() }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(entry = '/vendas') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <VendasPage />
    </MemoryRouter>
  );
}

function venda(id, nome) {
  return {
    id,
    nome,
    cliente: { nome },
    vendedoras: [],
    valores_unitarios_chips: [],
    criada_em: '2026-08-17T12:00:00Z'
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('VendasPage - carregamento e abertura do modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.obterReferenciasClientesVendas.mockResolvedValue([]);
    api.listarVendedoras.mockResolvedValue([]);
    api.listarDestinatariosProblemaVenda.mockResolvedValue([]);
    api.listarOperadoras.mockResolvedValue([]);
    api.listarServicos.mockResolvedValue([]);
    api.listarTiposVenda.mockResolvedValue([]);
    api.listarEtapasFunil.mockResolvedValue([]);
    api.listarClientesSelect.mockResolvedValue([]);
    api.criarVenda.mockResolvedValue({ id: 99 });
  });

  it('ignora uma resposta antiga quando o filtro já disparou uma busca mais recente', async () => {
    const antiga = deferred();
    const recente = deferred();
    api.listarVendas
      .mockReturnValueOnce(antiga.promise)
      .mockReturnValueOnce(recente.promise);

    renderPage();
    await waitFor(() => expect(api.listarVendas).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText(/Buscar por protocolo/i), {
      target: { value: 'Cliente recente' }
    });

    await waitFor(() => expect(api.listarVendas).toHaveBeenCalledTimes(2));
    await act(async () => {
      recente.resolve({ data: [venda(2, 'Cliente recente')], total: 1 });
    });
    expect(await screen.findByText('Cliente recente')).toBeInTheDocument();

    await act(async () => {
      antiga.resolve({ data: [venda(1, 'Cliente antigo')], total: 1 });
    });

    expect(screen.queryByText('Cliente antigo')).not.toBeInTheDocument();
    expect(screen.getByText('Cliente recente')).toBeInTheDocument();
  });

  it('restaura a busca e consulta a página selecionada após F5, sem voltar à primeira', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    api.listarVendas.mockResolvedValue({ data: [venda(1, 'Cliente encontrado')], total: 100 });
    const first = renderPage();
    await screen.findByText('Cliente encontrado');
    fireEvent.change(screen.getByPlaceholderText(/Buscar por protocolo/i), { target: { value: 'Cliente' } });
    await waitFor(() => expect(api.listarVendas).toHaveBeenLastCalledWith(expect.objectContaining({ busca: 'Cliente', page: 1 })));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(api.listarVendas).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    first.unmount();
    api.listarVendas.mockClear();
    renderPage();
    expect(screen.getByPlaceholderText(/Buscar por protocolo/i)).toHaveValue('Cliente');
    await waitFor(() => expect(api.listarVendas).toHaveBeenCalledTimes(1));
    expect(api.listarVendas).toHaveBeenLastCalledWith(expect.objectContaining({ busca: 'Cliente', page: 2 }));
  });

  it('reabre o detalhe com dados atuais em visualização e não o reabre depois de fechar', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    api.listarVendas.mockResolvedValue({ data: [venda(42, 'Cliente selecionado')], total: 1 });
    api.buscarVendaPorId.mockResolvedValue(venda(42, 'Cliente selecionado'));
    const first = renderPage();
    fireEvent.click(await screen.findByText('Cliente selecionado'));
    await screen.findByRole('dialog', { name: 'modal venda' });
    first.unmount();
    api.buscarVendaPorId.mockResolvedValue(venda(42, 'Dados atuais do cliente'));
    const second = renderPage();
    expect(await screen.findByRole('dialog', { name: 'modal venda' })).toHaveTextContent('Dados atuais do cliente');
    expect(screen.getByRole('dialog', { name: 'modal venda' })).toHaveTextContent('edição:false');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar detalhe' }));
    second.unmount();
    api.buscarVendaPorId.mockClear();
    renderPage();
    await screen.findByText('Cliente selecionado');
    expect(screen.queryByRole('dialog', { name: 'modal venda' })).not.toBeInTheDocument();
    expect(api.buscarVendaPorId).not.toHaveBeenCalled();
    expect(api.criarVenda).not.toHaveBeenCalled();
  });

  it('dá prioridade ao destino explícito de uma notificação sobre o detalhe anterior', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    sessionStorage.setItem('crm:navegacao:v1:1:VendasPage:detalhe', '42');
    api.listarVendas.mockResolvedValue({ data: [], total: 0 });
    api.buscarVendaPorId.mockResolvedValue(venda(99, 'Venda do link'));
    renderPage('/vendas?venda_id=99&aba=notas');
    expect(await screen.findByRole('dialog', { name: 'modal venda' })).toHaveTextContent('Venda do link');
    expect(api.buscarVendaPorId).toHaveBeenCalledExactlyOnceWith('99');
  });

  it('atualiza a aba do link ao navegar dentro do detalhe e mantém a nova aba no F5', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    api.listarVendas.mockResolvedValue({ data: [], total: 0 });
    api.buscarVendaPorId.mockResolvedValue(venda(99, 'Venda do link'));
    const first = renderPage('/vendas?venda_id=99&aba=notas');
    await screen.findByRole('dialog', { name: 'modal venda' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir documentos simulados' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('aba=arquivos'));
    expect(api.buscarVendaPorId).toHaveBeenCalledTimes(1);
    const updatedUrl = screen.getByTestId('location').textContent;
    first.unmount();
    renderPage(updatedUrl);
    expect(await screen.findByRole('dialog', { name: 'modal venda' })).toHaveTextContent('aba:arquivos');
  });

  it('abre uma nova venda uma única vez pela URL e limpa o parâmetro de navegação', async () => {
    api.listarVendas.mockResolvedValue({ data: [], total: 0 });

    renderPage({
      pathname: '/vendas',
      search: '?nova=1',
      state: {
        vendaPreenchida: { nome: 'Lead convertido' },
        clientePreenchido: { nome: 'Cliente do lead' },
        origemLead: { linha_id: 42 }
      }
    });

    expect(await screen.findByRole('dialog', { name: 'modal venda' })).toHaveTextContent('Lead convertido');
    expect(screen.getByRole('dialog', { name: 'modal venda' })).toHaveTextContent('Cliente do lead');
    expect(screen.getAllByRole('dialog', { name: 'modal venda' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar venda simulada' }));
    await waitFor(() => expect(api.criarVenda).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Lead convertido',
      origem_lead_linha_id: 42
    })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/vendas'));
  });
});

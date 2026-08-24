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
  default: ({ initialValues, clientePreenchido, onSave }) => (
    <section role="dialog" aria-label="modal venda">
      {initialValues?.nome || 'Nova venda'}
      <span>{clientePreenchido?.nome || ''}</span>
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

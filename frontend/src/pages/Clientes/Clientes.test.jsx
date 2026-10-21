import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Clientes from './Clientes';
import { getUsuarioLocal, temPermissao } from '../../services/auth.service';
import {
  buscarClientePorId,
  excluirCliente,
  listarClientes,
  listarClientesSelect
} from '../../services/cliente.service';
import { listarOperadoras, listarServicos, listarTiposVenda } from '../../services/config.service';
import {
  contarVendasConcluidasPorCliente,
  listarVendedoras,
  obterReferenciasClientesVendas
} from '../../services/venda.service';

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn()
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <main>{children}</main>
}));

vi.mock('./ClienteModal', () => ({
  default: ({ cliente, initialTab = 'cliente', notesOnly = false, onClose }) => (
    <section role="dialog" aria-label="modal cliente">
      <span>ClienteModal</span>
      <span>aba:{initialTab}</span>
      <span>notesOnly:{String(notesOnly)}</span>
      <span>cliente:{cliente?.nome || 'novo'}</span>
      <button type="button" onClick={onClose}>Fechar modal</button>
    </section>
  )
}));

vi.mock('../VendasPage/VendaModal', () => ({
  default: () => <section role="dialog" aria-label="modal venda">VendaModal</section>
}));

vi.mock('../../services/auth.service', () => ({
  getUsuarioLocal: vi.fn(),
  temPermissao: vi.fn()
}));

vi.mock('../../services/cliente.service', () => ({
  buscarClientePorId: vi.fn(),
  excluirCliente: vi.fn(),
  exportarClientesExcel: vi.fn(),
  importarBaseAnterior: vi.fn(),
  limparClientesBaseAnterior: vi.fn(),
  listarClientes: vi.fn(),
  listarClientesSelect: vi.fn(),
  previewImportacaoBaseAnterior: vi.fn()
}));

vi.mock('../../services/notificacao-abertura.service', async original => ({
  ...(await original()),
  confirmarAberturaNotificacao: vi.fn().mockResolvedValue(undefined),
  falharAberturaNotificacao: vi.fn()
}));

vi.mock('../../services/config.service', () => ({
  listarOperadoras: vi.fn(),
  listarServicos: vi.fn(),
  listarTiposVenda: vi.fn()
}));

vi.mock('../../services/venda.service', () => ({
  atualizarVenda: vi.fn(),
  buscarVendaPorId: vi.fn(),
  contarVendasConcluidasPorCliente: vi.fn(),
  enviarVendaParaPosVenda: vi.fn(),
  importarVendasEmpresas: vi.fn(),
  listarVendedoras: vi.fn(),
  obterReferenciasClientesVendas: vi.fn(),
  previewImportacaoVendasEmpresas: vi.fn()
}));

const clientePadrao = {
  id: 7,
  nome: 'Maria Silva',
  razao_social: 'Maria Silva LTDA',
  cnpj: '11.222.333/0001-81',
  responsavel_tipo: 'adm',
  responsavel_nome: 'Roberta',
  email: 'maria@example.com',
  whatsapp_ddd: '11',
  whatsapp_numero: '999999999',
  fixo_ddd: '',
  fixo_numero: '',
  valor_pago: 150,
  quantidade_chips: 3,
  created_at: '2026-05-20T12:00:00Z',
  aviso_fidelidade: { dias_restantes: 5, deve_avisar: true },
  notas_resumo: { notas_com_retorno_total: 0 },
  operadoras_atuais: [
    {
      operadora: { nome: 'Claro' },
      quantidade_chips: 3,
      valor_pago: 150,
      fidelidade_fim: '2026-12-31'
    }
  ],
  criador: { nome: 'Admin' }
};

function setPermissoes(permissoes) {
  const permitidas = new Set(permissoes);
  temPermissao.mockImplementation((_usuario, permissao) => {
    if (Array.isArray(permissao)) return permissao.some(item => permitidas.has(item));
    return permitidas.has(permissao);
  });
}

function mockCargaInicial({ clientes = [clientePadrao], total = clientes.length } = {}) {
  listarClientes.mockResolvedValue({ data: clientes, total });
  listarOperadoras.mockResolvedValue([{ id: 1, nome: 'Claro' }]);
  contarVendasConcluidasPorCliente.mockResolvedValue({});
  listarClientesSelect.mockResolvedValue([]);
  listarVendedoras.mockResolvedValue([]);
  obterReferenciasClientesVendas.mockResolvedValue([]);
  listarTiposVenda.mockResolvedValue([]);
  listarServicos.mockResolvedValue([]);
}

function renderClientes(entry = '/clientes') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Clientes />
    </MemoryRouter>
  );
}

describe('Clientes page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsuarioLocal.mockReturnValue({ id: 1, nome: 'Admin' });
    setPermissoes([
      'clientes_ver_todos',
      'clientes_criar',
      'clientes_editar',
      'clientes_excluir',
      'clientes_importar_planilhas',
      'vendas_ver_todas'
    ]);
    mockCargaInicial();
  });

  it('renderiza clientes e acoes conforme permissoes', async () => {
    renderClientes();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /novo cliente/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /importar excel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exportar excel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lixeira/i })).toBeInTheDocument();
  });

  it('abre o cliente da notificação mesmo quando filtros salvos o ocultam da lista', async () => {
    localStorage.setItem('usuario', '{"id":1}');
    sessionStorage.setItem('crm:navegacao:v1:1:Clientes:busca', '"Outra empresa"');
    mockCargaInicial({ clientes: [] });
    buscarClientePorId.mockResolvedValue(clientePadrao);
    renderClientes(`/clientes?cliente_id=${clientePadrao.id}&aba=notas&notificacao_id=55`);
    const modal = await screen.findByRole('dialog', { name: 'modal cliente' });
    expect(modal).toHaveTextContent('cliente:Maria Silva');
    expect(modal).toHaveTextContent('aba:notas');
    expect(buscarClientePorId).toHaveBeenCalledExactlyOnceWith(String(clientePadrao.id));
  });

  it('esconde acoes protegidas quando o usuario nao tem permissoes', async () => {
    setPermissoes(['clientes_ver_todos']);

    renderClientes();

    expect(await screen.findByText('Maria Silva')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /novo cliente/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /importar excel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exportar excel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lixeira/i })).not.toBeInTheDocument();
  });

  it('formata busca por telefone e recarrega com campo especifico', async () => {
    const user = userEvent.setup();

    renderClientes();
    await screen.findByText('Maria Silva');

    await user.click(screen.getByRole('button', { name: /busca geral/i }));
    await user.click(screen.getByRole('button', { name: /^telefone$/i }));

    const input = screen.getByPlaceholderText('(11) 99999-9999');
    await user.type(input, '11999999999');

    expect(input).toHaveValue('(11) 99999-9999');

    await waitFor(() => {
      expect(listarClientes).toHaveBeenLastCalledWith(expect.objectContaining({
        busca: '',
        busca_campo: 'telefone',
        busca_valor: '(11) 99999-9999',
        page: 1,
        per_page: 20
      }));
    });
  });

  it('abre filtros e conta filtros preenchidos', async () => {
    const user = userEvent.setup();

    renderClientes();
    await screen.findByText('Maria Silva');

    await user.click(screen.getByRole('button', { name: /^filtros$/i }));

    const popup = document.querySelector('.filtros-popup');
    expect(within(popup).getByText(/Respons/)).toBeInTheDocument();
    expect(within(popup).getByText('Fidelidade')).toBeInTheDocument();

    await user.click(within(popup).getAllByRole('button', { name: /todas/i })[0]);
    const opcoesClaro = screen.getAllByRole('button', { name: /claro/i });
    await user.click(opcoesClaro[opcoesClaro.length - 1]);

    expect(screen.getByRole('button', { name: /filtros\s*1/i })).toBeInTheDocument();
  });

  it('abre somente notas ao clicar no botao de nota sem abrir edicao da linha', async () => {
    const user = userEvent.setup();

    renderClientes();
    await screen.findByText('Maria Silva');

    await user.click(screen.getByRole('button', { name: /^nota$/i }));

    expect(screen.getByRole('dialog', { name: /modal cliente/i })).toBeInTheDocument();
    expect(screen.getByText('aba:notas')).toBeInTheDocument();
    expect(screen.getByText('notesOnly:true')).toBeInTheDocument();
    expect(screen.getByText('cliente:Maria Silva')).toBeInTheDocument();
  });

  it('abre edicao ao clicar na linha quando pode editar', async () => {
    const user = userEvent.setup();

    renderClientes();
    await screen.findByText('Maria Silva');

    await user.click(screen.getByRole('button', { name: /maria silva maria silva ltda/i }));

    expect(screen.getByRole('dialog', { name: /modal cliente/i })).toBeInTheDocument();
    expect(screen.getByText('aba:cliente')).toBeInTheDocument();
    expect(screen.getByText('notesOnly:false')).toBeInTheDocument();
  });

  it('confirma envio do cliente para a lixeira', async () => {
    const user = userEvent.setup();
    excluirCliente.mockResolvedValue({});

    renderClientes();
    await screen.findByText('Maria Silva');

    const botoesExcluir = screen.getAllByRole('button', { name: /^excluir$/i });
    await user.click(botoesExcluir[botoesExcluir.length - 1]);
    expect(screen.getByText(/enviar cliente para a lixeira/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /enviar para lixeira/i }));

    await waitFor(() => expect(excluirCliente).toHaveBeenCalledWith(7));
    expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument();
  });

  it('navega para lixeira de clientes pelo botao principal', async () => {
    const user = userEvent.setup();

    renderClientes();
    await screen.findByText('Maria Silva');

    await user.click(screen.getByRole('button', { name: /lixeira/i }));

    expect(navigateMock).toHaveBeenCalledWith('/clientes/lixeira');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutomacoesPage from './AutomacoesPage';
import ProblemasPage from '../ProblemasPage/ProblemasPage';

const api = vi.hoisted(() => ({
  coletarHistoricoAutomacoes: vi.fn(),
  descartarAutomacao: vi.fn(),
  listarAutomacoes: vi.fn(),
  obterResumoAutomacoes: vi.fn(),
  repetirAutomacao: vi.fn(),
  revisarAutomacao: vi.fn(),
  listarProblemasAutomaticos: vi.fn(),
  resolverProblemaAutomatico: vi.fn(),
  obterVendaProblemaAutomatico: vi.fn()
}));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <div data-testid="layout-privado">{children}</div>
}));

vi.mock('../../services/automacao.service', () => api);
vi.mock('../VendasPage/VendaModal', () => ({
  default: ({ venda, onClose }) => <section role="dialog" aria-label="Venda completa"><span>Modal da venda #{venda.id}</span><button type="button" onClick={onClose}>Fechar venda</button></section>
}));
vi.mock('../../services/cliente.service', () => ({ listarClientesSelect: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/config.service', () => ({
  listarOperadoras: vi.fn().mockResolvedValue([]),
  listarServicos: vi.fn().mockResolvedValue([]),
  listarTiposVenda: vi.fn().mockResolvedValue([])
}));
vi.mock('../../services/venda.service', () => ({ atualizarVenda: vi.fn(), listarVendedoras: vi.fn().mockResolvedValue([]) }));

const resumo = {
  habilitada: false,
  ultima_mensagem_em: null,
  contadores: { concluido: 3, revisao: 2, erro: 1 }
};

const execucao = {
  id: 10,
  assunto: 'Workflow de venda VIVO',
  remetente: 'workflow@vivo.example',
  recebido_em: '2026-08-31T12:00:00.000Z',
  status: 'revisao',
  venda_id: 42,
  classificacao: 'tipo_2',
  erro: 'Venda ambígua.',
  corpo_texto: 'Mensagem original da operadora',
  dados_extraidos: {
    classificacao: 'tipo_2',
    destino: 'Correção do Pedido de Venda Pelo Consultor',
    documento: '11143938000187',
    mensagem_operador: 'Corrigir o pedido.'
  }
};

describe('Painéis da automação Gmail VIVO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.listarAutomacoes.mockResolvedValue({ data: [] });
    api.obterResumoAutomacoes.mockResolvedValue(resumo);
    api.listarProblemasAutomaticos.mockResolvedValue({ data: [], total: 0, page: 1, per_page: 20, totals: { abertos: 0, resolvidos: 0 } });
    api.revisarAutomacao.mockResolvedValue({});
    api.repetirAutomacao.mockResolvedValue({});
    api.descartarAutomacao.mockResolvedValue({});
    api.coletarHistoricoAutomacoes.mockResolvedValue({ coletados: 4, processados: 4 });
    api.resolverProblemaAutomatico.mockResolvedValue({});
  });

  it('renderiza automações no layout privado e apresenta o estado vazio', async () => {
    render(<AutomacoesPage />);

    expect(screen.getByTestId('layout-privado')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma execução encontrada')).toBeInTheDocument();
    expect(screen.getByText('Gmail desabilitado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mostrar todas as 6 execuções' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('usa os contadores como filtros e traduz os estados', async () => {
    const user = userEvent.setup();
    render(<AutomacoesPage />);
    await screen.findByText('Nenhuma execução encontrada');

    await user.click(screen.getByRole('button', { name: 'Filtrar por Revisão manual: 2' }));

    await waitFor(() => expect(api.listarAutomacoes).toHaveBeenLastCalledWith('revisao'));
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('revisao');
    expect(screen.getByText('Não há execuções com o status “Revisão manual”.')).toBeInTheDocument();
  });

  it('apresenta os detalhes extraídos e o formulário de revisão', async () => {
    api.listarAutomacoes.mockResolvedValue({ data: [execucao] });
    render(<AutomacoesPage />);

    expect(await screen.findByText('Workflow de venda VIVO')).toBeInTheDocument();
    expect(screen.getByText('Problema pós-venda')).toBeInTheDocument();
    expect(screen.getByText('Correção do Pedido de Venda Pelo Consultor')).toBeInTheDocument();
    expect(screen.getByText('Mensagem original da operadora')).toBeInTheDocument();
    expect(screen.getByText('Corrija os dados abaixo antes de reprocessar esta execução.')).toBeInTheDocument();
  });

  it('mantém o layout e exibe falhas de carregamento', async () => {
    api.listarAutomacoes.mockRejectedValue(new Error('Falha ao consultar automações.'));
    render(<AutomacoesPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao consultar automações.');
    expect(screen.getByTestId('layout-privado')).toBeInTheDocument();
  });

  it('busca o histórico quando a integração está ativa', async () => {
    const user = userEvent.setup();
    api.obterResumoAutomacoes.mockResolvedValue({ ...resumo, habilitada: true });
    render(<AutomacoesPage />);

    await user.click(await screen.findByRole('button', { name: 'Buscar e-mails anteriores' }));

    await waitFor(() => expect(api.coletarHistoricoAutomacoes).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('4 e-mail(is) anterior(es) encontrado(s); 4 processado(s) agora.');
  });

  it('renderiza o painel de problemas no layout e apresenta a pendência', async () => {
    api.listarProblemasAutomaticos.mockResolvedValue({ data: [{
        problema_id: 7,
        venda_id: 42,
        venda_nome: 'Empresa Exemplo',
        cnpj: '11.143.938/0001-87',
        recebido_em: '2026-08-31T11:58:00.000Z',
        aberto_em: '2026-08-31T12:00:00.000Z',
        venda_resumo: {
          vendedoras: [{ id: 3, nome: 'Thayara' }], data_venda: '2026-07-31', data_venda_origem: 'comercial',
          chips: [{ quantidade: 2, gb: '30', tipo_linha: 'novo', operadora_atual: null, operadora_destino: 'VIVO', vendedora: 'Thayara', valor_unitario: 59.9, subtotal: 119.8 }]
        },
        dados_extraidos: { mensagem_operador: 'Corrigir o pedido de venda.' },
        eventos: [{ id: 1, tipo: 'abertura_automatica', mensagem: 'Auditoria não conseguiu contato.', created_at: '2026-08-31T12:00:00.000Z' }]
      }], total: 1, page: 1, per_page: 20, totals: { abertos: 1, resolvidos: 0 } });

    render(<ProblemasPage />);

    expect(await screen.findByText(/Venda #42 — Empresa Exemplo/)).toBeInTheDocument();
    expect(screen.getByTestId('layout-privado')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Informações principais da venda' })).not.toBeInTheDocument();
    expect(screen.queryByText('Corrigir o pedido de venda.')).not.toBeInTheDocument();
    const expandir = screen.getByRole('button', { name: 'Expandir informações' });
    expect(expandir).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(expandir);
    expect(screen.getByRole('region', { name: 'Informações principais da venda' })).toHaveTextContent('Thayara');
    expect(screen.getByRole('region', { name: 'Informações principais da venda' })).toHaveTextContent('31/07/2026');
    expect(screen.getByRole('table')).toHaveTextContent('2×30 GB · Novo');
    expect(screen.getByRole('table')).toHaveTextContent('R$ 119,80');
    expect(screen.getByText('Corrigir o pedido de venda.')).toBeInTheDocument();
    expect(screen.getByText(/Problema identificado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolver problema' })).toBeDisabled();
    await waitFor(() => expect(localStorage.getItem('problemas-page:expandidos:v1:anonimo')).toBe('[7]'));
  });

  it('expande e recolhe ao clicar no cabeçalho do card', async () => {
    const user = userEvent.setup();
    api.listarProblemasAutomaticos.mockResolvedValue({
      data: [{ problema_id: 18, venda_id: 90, venda_nome: 'Cabeçalho clicável', venda_resumo: { vendedoras: [], chips: [] }, dados_extraidos: { mensagem_operador: 'Detalhe pelo cabeçalho.' }, eventos: [] }],
      total: 1, page: 1, per_page: 20, totals: { abertos: 1, resolvidos: 0 }
    });
    render(<ProblemasPage />);

    const cabecalho = await screen.findByRole('button', { name: 'Expandir informações da venda #90' });
    await user.click(cabecalho);
    expect(screen.getByText('Detalhe pelo cabeçalho.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recolher informações da venda #90' }));
    expect(screen.queryByText('Detalhe pelo cabeçalho.')).not.toBeInTheDocument();
  });

  it('consulta o histórico resolvido e expõe responsável, data e observação', async () => {
    const user = userEvent.setup();
    api.listarProblemasAutomaticos
      .mockResolvedValueOnce({ data: [], total: 0, page: 1, per_page: 20, totals: { abertos: 0, resolvidos: 1 } })
      .mockResolvedValueOnce({
        data: [{
          problema_id: 9, venda_id: 55, venda_nome: 'Cliente resolvido', recebido_em: '2026-08-30T10:00:00.000Z', aberto_em: '2026-08-30T10:02:00.000Z',
          dados_extraidos: { mensagem_operador: 'Ajustar cadastro.' }, eventos: [],
          resolucao: { mensagem: 'Cadastro atualizado na operadora.', resolvido_em: '2026-08-31T15:30:00.000Z', usuario: { id: 4, nome: 'Maria Silva' } }
        }], total: 1, page: 1, per_page: 20, totals: { abertos: 0, resolvidos: 1 }
      });

    render(<ProblemasPage />);
    await user.click(await screen.findByRole('tab', { name: 'Problemas resolvidos 1' }));
    await user.click(await screen.findByRole('button', { name: 'Expandir informações' }));

    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Cadastro atualizado na operadora.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolver problema' })).not.toBeInTheDocument();
    expect(api.listarProblemasAutomaticos).toHaveBeenLastCalledWith({ status: 'resolvidos', page: 1, perPage: 20 });
  });

  it('restaura cartões expandidos e pagina sem carregar todos os registros', async () => {
    const user = userEvent.setup();
    localStorage.setItem('problemas-page:expandidos:v1:anonimo', '[7]');
    const resposta = {
      data: [{ problema_id: 7, venda_id: 42, venda_nome: 'Empresa Exemplo', dados_extraidos: { mensagem_operador: 'Detalhe restaurado.' }, eventos: [] }],
      total: 21, page: 1, per_page: 20, totals: { abertos: 21, resolvidos: 0 }
    };
    api.listarProblemasAutomaticos.mockResolvedValue(resposta);

    render(<ProblemasPage />);

    expect(await screen.findByRole('button', { name: 'Recolher informações' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Detalhe restaurado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(api.listarProblemasAutomaticos).toHaveBeenLastCalledWith({ status: 'abertos', page: 2, perPage: 20 }));
  });

  it('abre e fecha a venda completa sem navegar para outra página', async () => {
    const user = userEvent.setup();
    api.listarProblemasAutomaticos.mockResolvedValue({
      data: [{ problema_id: 12, venda_id: 81, venda_nome: 'Venda modal', eventos: [], dados_extraidos: {} }],
      total: 1, page: 1, per_page: 20, totals: { abertos: 1, resolvidos: 0 }
    });
    api.obterVendaProblemaAutomatico.mockResolvedValue({ id: 81, cliente: null, vendedoras: [] });
    render(<ProblemasPage />);

    await user.click(await screen.findByRole('button', { name: 'Abrir venda completa' }));
    expect(await screen.findByRole('dialog', { name: 'Venda completa' })).toHaveTextContent('Modal da venda #81');
    await user.click(screen.getByRole('button', { name: 'Fechar venda' }));
    expect(screen.queryByRole('dialog', { name: 'Venda completa' })).not.toBeInTheDocument();
  });
});

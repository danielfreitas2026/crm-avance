import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AutomacoesPage from './AutomacoesPage';
import ProblemasPage from '../ProblemasPage/ProblemasPage';

const api = vi.hoisted(() => ({
  descartarAutomacao: vi.fn(),
  listarAutomacoes: vi.fn(),
  obterResumoAutomacoes: vi.fn(),
  repetirAutomacao: vi.fn(),
  revisarAutomacao: vi.fn(),
  listarProblemasAutomaticos: vi.fn(),
  resolverProblemaAutomatico: vi.fn()
}));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({
  default: ({ children }) => <div data-testid="layout-privado">{children}</div>
}));

vi.mock('../../services/automacao.service', () => api);

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
    api.listarAutomacoes.mockResolvedValue({ data: [] });
    api.obterResumoAutomacoes.mockResolvedValue(resumo);
    api.listarProblemasAutomaticos.mockResolvedValue([]);
    api.revisarAutomacao.mockResolvedValue({});
    api.repetirAutomacao.mockResolvedValue({});
    api.descartarAutomacao.mockResolvedValue({});
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

  it('renderiza o painel de problemas no layout e apresenta a pendência', async () => {
    api.listarProblemasAutomaticos.mockResolvedValue([{
      problema_id: 7,
      venda_id: 42,
      venda_nome: 'Empresa Exemplo',
      cnpj: '11.143.938/0001-87',
      aberto_em: '2026-08-31T12:00:00.000Z',
      dados_extraidos: { mensagem_operador: 'Corrigir o pedido de venda.' },
      eventos: [{ id: 1, tipo: 'abertura_automatica', mensagem: 'Auditoria não conseguiu contato.' }]
    }]);

    render(<ProblemasPage />);

    expect(await screen.findByText(/Venda #42 — Empresa Exemplo/)).toBeInTheDocument();
    expect(screen.getByTestId('layout-privado')).toBeInTheDocument();
    expect(screen.getByText('Corrigir o pedido de venda.')).toBeInTheDocument();
    expect(screen.getByText('Problema identificado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolver problema' })).toBeDisabled();
  });
});

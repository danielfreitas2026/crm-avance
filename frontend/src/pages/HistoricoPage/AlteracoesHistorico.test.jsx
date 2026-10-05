import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AlteracoesHistorico from './AlteracoesHistorico';

describe('Detalhes das edições no histórico', () => {
  it('preserva uma etapa anterior vazia registrada em histórico antigo', () => {
    render(<AlteracoesHistorico dados={{ movimentacao: { status_anterior: null, status_novo: 'concluida' } }} />);
    expect(screen.getByText('Não informado')).toBeInTheDocument();
    expect(screen.getByText('concluida')).toBeInTheDocument();
  });
  it('mostra explicitamente a data antiga e a nova e detalha o chip alterado', () => {
    render(<AlteracoesHistorico dados={{ alteracoes_detalhadas: [
      { campo: 'data_venda', anterior: '2026-08-27', novo: '2026-10-01' },
      { campo: 'valores_unitarios_chips[0].valor_unitario', anterior: 100, novo: 150 }
    ] }} />);
    expect(screen.getByText('Data da venda')).toBeInTheDocument();
    expect(screen.getByText('27/08/2026')).toBeInTheDocument();
    expect(screen.getByText('01/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Chip 1 · Valor unitário')).toBeInTheDocument();
    expect(screen.getAllByText('Valor anterior')).toHaveLength(2);
  });

  it('adapta registros antigos sem afirmar alterações ou inventar o valor anterior', () => {
    render(<AlteracoesHistorico dados={{ alteracoes: { nome: 'Novo', ativo: false, permissoes: ['vendas'] } }} />);
    expect(screen.getByText('Dados registrados na edição')).toBeInTheDocument();
    expect(screen.getAllByText('Valor anterior não registrado')).toHaveLength(3);
    expect(screen.getByText('Não')).toBeInTheDocument();
    expect(screen.getByText(/vendas/)).toBeInTheDocument();
  });

  it('preserva valores anteriores explicitamente salvos em formatos antigos', () => {
    render(<AlteracoesHistorico dados={{ alteracoes: [{ campo: 'nome', anterior: 'Antigo', novo: 'Novo' }] }} />);
    expect(screen.getByText('Antigo')).toBeInTheDocument();
    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('distingue campo removido de valor anterior desconhecido e não expõe segredos', () => {
    render(<AlteracoesHistorico dados={{ alteracoes_detalhadas: [
      { campo: 'email', anterior: 'antigo@teste.com', novo: null },
      { campo: 'senha', anterior: 'hash-antigo', novo: 'hash-novo' }
    ] }} />);
    expect(screen.getByText('antigo@teste.com')).toBeInTheDocument();
    expect(screen.getByText('Não informado')).toBeInTheDocument();
    expect(screen.queryByText(/hash-/)).not.toBeInTheDocument();
    expect(screen.getByText(/Dado protegido/)).toBeInTheDocument();
  });

  it('não apresenta o formulário inteiro como alterado quando a edição não mudou nada', () => {
    render(<AlteracoesHistorico dados={{ alteracoes: { nome: 'Igual' }, alteracoes_detalhadas: [] }} />);
    expect(screen.getByText('Nenhum dado foi alterado nesta edição.')).toBeInTheDocument();
    expect(screen.queryByText('Igual')).not.toBeInTheDocument();
  });
});

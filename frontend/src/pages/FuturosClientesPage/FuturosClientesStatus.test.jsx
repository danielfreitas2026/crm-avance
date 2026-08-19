import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AvaliacaoPrimeiraLigacao,
  LeadStatusMailing
} from './FuturosClientesPage';
import { getClasseLinhaLead, isVendaRecusada } from './lead-status';

describe('status de venda recusada no mailing recebido', () => {
  const recusadaAposReversao = {
    futuro_cliente: 0,
    status_operacional: 'perdido',
    venda_recusada_em: '2026-08-13 10:00:00',
    venda_recusada_motivo: 'Cliente nao aprovou a proposta.'
  };

  it('reconhece a recusa sem depender do estado de futuro cliente', () => {
    expect(isVendaRecusada(recusadaAposReversao)).toBe(true);
    expect(getClasseLinhaLead(recusadaAposReversao)).toBe('lead-row-recusado');
  });

  it('exibe o chip e o motivo para uma venda recusada depois da reversao', () => {
    render(<LeadStatusMailing linha={recusadaAposReversao} />);

    expect(screen.getByText('Venda recusada')).toBeVisible();
    expect(screen.getByTitle('Cliente nao aprovou a proposta.')).toBeVisible();
  });

  it('mantem o reconhecimento para um futuro cliente recusado', () => {
    expect(isVendaRecusada({ ...recusadaAposReversao, futuro_cliente: 1 })).toBe(true);
  });

  it('nao confunde cliente recusou com venda recusada em registro legado', () => {
    expect(isVendaRecusada({
      futuro_cliente: 0,
      status_operacional: 'perdido',
      cliente_recusou: 1
    })).toBe(false);
  });
});

describe('avaliação da primeira ligação', () => {
  it('exibe os textos acentuados quando a ligação ainda não foi avaliada', () => {
    render(<AvaliacaoPrimeiraLigacao linha={{}} />);

    expect(screen.getByText('Avaliação da primeira ligação')).toBeVisible();
    expect(screen.getByText('Ainda não avaliada')).toBeVisible();
  });
});

describe('ocultação visual de venda registrada no mailing', () => {
  it('mantem o futuro cliente e oculta somente o chip da venda', () => {
    render(<LeadStatusMailing linha={{
      futuro_cliente: 1,
      venda_id: 72,
      status_operacional: 'vendido',
      venda_registrada_oculta: 1
    }} />);

    expect(screen.queryByText('Venda registrada')).not.toBeInTheDocument();
    expect(screen.getByText('Futuro cliente')).toBeVisible();
  });
});

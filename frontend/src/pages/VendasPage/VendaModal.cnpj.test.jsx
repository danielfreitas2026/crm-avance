import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

import VendaModal from './VendaModal';

describe('VendaModal - consulta automática de CNPJ', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mantém o preenchimento manual sem consultar serviços externos', () => {
    render(
      <VendaModal
        clientes={[]}
        vendedoras={[]}
        operadoras={[]}
        tiposVenda={[]}
        servicos={[]}
        vendasPorCliente={new Map()}
        usuarioLogado={{ id: 1, permissoes: {} }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.queryByText(/ID da venda:/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('00.000.000/0000-00'), {
      target: { value: '12.345.678/0001-95' }
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /buscar dados/i })).not.toBeInTheDocument();
  });

  it('ignora e remove o rascunho anterior quando recebe dados do mailing', () => {
    localStorage.setItem('form_draft_venda_novo', JSON.stringify({
      nome: 'Cliente antigo',
      razao_social: 'Cliente Antigo LTDA',
      cnpj: '11.111.111/1111-11'
    }));

    render(
      <VendaModal
        initialValues={{
          nome: 'Lead do mailing',
          razao_social: 'Lead do Mailing LTDA',
          cnpj: '12.345.678/0001-95'
        }}
        initialDraft={{
          nome: 'Cliente do rascunho em memoria',
          razao_social: 'Rascunho em Memoria LTDA'
        }}
        clientes={[]}
        vendedoras={[]}
        operadoras={[]}
        tiposVenda={[]}
        servicos={[]}
        vendasPorCliente={new Map()}
        usuarioLogado={{ id: 1, permissoes: {} }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Lead do mailing')).toBeVisible();
    expect(screen.getByDisplayValue('Lead do Mailing LTDA')).toBeVisible();
    expect(screen.queryByDisplayValue('Cliente antigo')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Cliente do rascunho em memoria')).not.toBeInTheDocument();
    expect(localStorage.getItem('form_draft_venda_novo')).toBeNull();
  });

  it('restaura o rascunho ao abrir uma venda diretamente', () => {
    localStorage.setItem('form_draft_venda_novo', JSON.stringify({
      nome: 'Cliente do rascunho',
      razao_social: 'Cliente Rascunho LTDA'
    }));

    render(
      <VendaModal
        clientes={[]}
        vendedoras={[]}
        operadoras={[]}
        tiposVenda={[]}
        servicos={[]}
        vendasPorCliente={new Map()}
        usuarioLogado={{ id: 1, permissoes: {} }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Cliente do rascunho')).toBeVisible();
    expect(screen.getByDisplayValue('Cliente Rascunho LTDA')).toBeVisible();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SaleCard } from './FunilPage';
import { vendaCorrespondeAtalhos, vendaSemDocumento } from './funilFiltros';

function criarSale(sobrescritas = {}) {
  return {
    id: 1,
    client: 'Cliente teste',
    value: 99.9,
    operator: 'Vivo',
    plan: 'Telefonia móvel',
    priority: 'media',
    seller: { name: 'Vendedora', initials: 'VE' },
    raw: { possui_doc_na_casa: false, total_arquivos: 0 },
    updated: new Date(),
    passagensEtapas: [],
    ...sobrescritas
  };
}

function renderCard(sale, props = {}) {
  return render(
    <SaleCard
      sale={sale}
      onClick={vi.fn()}
      onEmail={vi.fn()}
      onXlsxClaro={vi.fn()}
      onWhatsapp={vi.fn()}
      onProblema={vi.fn()}
      podeOperarPosVenda={false}
      {...props}
    />
  );
}

describe('FunilPage - documentacao e atalhos rapidos', () => {
  it.each([
    [{ possui_doc_na_casa: true, total_arquivos: 0 }, false],
    [{ possui_doc_na_casa: 1, total_arquivos: 0 }, false],
    [{ possui_doc_na_casa: '1', total_arquivos: 0 }, false],
    [{ possui_doc_na_casa: false, total_arquivos: 2 }, false],
    [{ possui_doc_na_casa: false, total_arquivos: '1' }, false],
    [{ possui_doc_na_casa: false, total_arquivos: 0 }, true],
    [{}, true]
  ])('identifica venda sem documento para os valores recebidos da API', (venda, esperado) => {
    expect(vendaSemDocumento(venda)).toBe(esperado);
  });

  it('aplica os modos de canceladas e sem documento', () => {
    const ativaComDoc = criarSale({ id: 1, semDocumento: false });
    const ativaSemDoc = criarSale({ id: 2, semDocumento: true });
    const canceladaComDoc = criarSale({ id: 3, canceladaEm: '2026-08-27', semDocumento: false });
    const canceladaSemDoc = criarSale({ id: 4, canceladaEm: '2026-08-27', semDocumento: true });
    const vendas = [ativaComDoc, ativaSemDoc, canceladaComDoc, canceladaSemDoc];
    const ids = filtros => vendas.filter(venda => vendaCorrespondeAtalhos(venda, filtros)).map(venda => venda.id);

    expect(ids({})).toEqual([1, 2, 3, 4]);
    expect(ids({ canceladas: 'ocultar' })).toEqual([1, 2]);
    expect(ids({ canceladas: 'somente' })).toEqual([3, 4]);
    expect(ids({ semDocumento: 'ocultar' })).toEqual([1, 3]);
    expect(ids({ semDocumento: 'somente' })).toEqual([2, 4]);
  });

  it('combina os dois grupos de atalhos por intersecao', () => {
    const vendas = [
      criarSale({ id: 1, semDocumento: false }),
      criarSale({ id: 2, semDocumento: true }),
      criarSale({ id: 3, canceladaEm: '2026-08-27', semDocumento: false }),
      criarSale({ id: 4, canceladaEm: '2026-08-27', semDocumento: true })
    ];

    const resultado = vendas.filter(venda => vendaCorrespondeAtalhos(venda, {
      canceladas: 'somente',
      semDocumento: 'somente'
    }));

    expect(resultado.map(venda => venda.id)).toEqual([4]);
  });

  it('destaca venda finalizada sem documento em amarelo e mantem as duas tags', () => {
    renderCard(criarSale({ semDocumento: true }), { finalizada: true });

    const card = screen.getByText('Cliente teste').closest('.sale-card');
    expect(card).toHaveClass('sale-card-sem-documento', 'sale-card-finalizada');
    expect(screen.getByText('Venda sem doc')).toBeInTheDocument();
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
  });

  it('mantem a classe vermelha e as duas tags quando a venda sem documento esta cancelada', () => {
    renderCard(criarSale({ canceladaEm: '2026-08-27', semDocumento: true }));

    const card = screen.getByText('Cliente teste').closest('.sale-card');
    expect(card).toHaveClass('sale-card-cancelada', 'sale-card-sem-documento');
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    expect(screen.getByText('Venda sem doc')).toBeInTheDocument();
  });
});

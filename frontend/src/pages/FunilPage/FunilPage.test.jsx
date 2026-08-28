import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  buscarVendaPorId: vi.fn(),
  listarArquivosVenda: vi.fn()
}));

vi.mock('../../services/venda.service', async importOriginal => ({
  ...(await importOriginal()),
  buscarVendaPorId: api.buscarVendaPorId,
  listarArquivosVenda: api.listarArquivosVenda
}));

import { SaleCard, SaleModal } from './FunilPage';
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
    lancadaEm: new Date(),
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

  it('exibe Aceite e Biometria em cinza ou verde somente na etapa marcada', () => {
    const { rerender } = renderCard(criarSale({
      aceiteConcluido: false,
      biometriaConcluida: true
    }));

    expect(screen.queryByRole('button', { name: 'Aceite' })).not.toBeInTheDocument();

    rerender(
      <SaleCard
        sale={criarSale({ aceiteConcluido: false, biometriaConcluida: true })}
        aceiteBiometria
        onClick={vi.fn()}
        onEmail={vi.fn()}
        onXlsxClaro={vi.fn()}
        onWhatsapp={vi.fn()}
        onProblema={vi.fn()}
        podeOperarPosVenda={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Aceite' })).not.toHaveClass('is-complete');
    expect(screen.getByRole('button', { name: 'Biometria' })).toHaveClass('is-complete');
  });

  it('alterna a tag sem abrir o cartao', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onToggleMarcador = vi.fn();
    const sale = criarSale({ aceiteConcluido: false, biometriaConcluida: false });

    renderCard(sale, { aceiteBiometria: true, onClick, onToggleMarcador });
    await user.click(screen.getByRole('button', { name: 'Aceite' }));

    expect(onToggleMarcador).toHaveBeenCalledWith(sale, 'aceite', true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('mantem os rotulos estaveis e bloqueia novos cliques enquanto salva', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onToggleMarcador = vi.fn();

    renderCard(criarSale(), {
      aceiteBiometria: true,
      marcadorSaving: '1:aceite',
      onClick,
      onToggleMarcador
    });

    const aceite = screen.getByRole('button', { name: 'Aceite' });
    const biometria = screen.getByRole('button', { name: 'Biometria' });
    expect(aceite).toHaveTextContent('Aceite');
    expect(aceite).toHaveClass('is-saving');
    expect(aceite).toHaveAttribute('aria-busy', 'true');
    expect(aceite).toHaveAttribute('aria-disabled', 'true');
    expect(biometria).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Salvando...')).not.toBeInTheDocument();

    await user.click(aceite);
    await user.click(biometria);
    expect(onToggleMarcador).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('desabilita os marcadores de uma venda cancelada', () => {
    renderCard(criarSale({ canceladaEm: '2026-08-28' }), { aceiteBiometria: true });

    expect(screen.getByRole('button', { name: 'Aceite' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Biometria' })).toBeDisabled();
  });

  it('permite marcar documento na casa pelo modal rapido', async () => {
    const user = userEvent.setup();
    const onUpdatePossuiDocNaCasa = vi.fn().mockResolvedValue(undefined);
    const sale = criarSale({
      stage: 'pedido_operadora',
      historico: [],
      raw: { possui_doc_na_casa: false, total_arquivos: 0 }
    });
    api.buscarVendaPorId.mockResolvedValue({
      id: sale.id,
      status_funil: sale.stage,
      possui_doc_na_casa: false
    });
    api.listarArquivosVenda.mockResolvedValue({
      arquivos: [],
      etapas_arquivos: [],
      pacote: null
    });

    render(
      <SaleModal
        sale={sale}
        stages={[{ id: sale.stage, name: 'Pedido na operadora' }]}
        stageLabels={{ [sale.stage]: 'Pedido na operadora' }}
        onClose={vi.fn()}
        onUpdateSale={vi.fn()}
        onUpdatePossuiDocNaCasa={onUpdatePossuiDocNaCasa}
        onCancelSale={vi.fn()}
        onReverterCancelamento={vi.fn()}
        podeEditarVenda
        podeVerDocumentos
        podeAdicionarDocumentos
      />
    );

    await user.click(screen.getByRole('button', { name: 'Documentos' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Venda possui doc na casa' });
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    await waitFor(() => {
      expect(onUpdatePossuiDocNaCasa).toHaveBeenCalledWith(sale.id, true);
    });
  });
});

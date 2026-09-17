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
  it('exibe quando a venda entrou pela ultima vez na etapa concluida', async () => {
    const sale = criarSale({
      stage: 'concluido',
      historico: []
    });
    api.buscarVendaPorId.mockResolvedValue({
      id: sale.id,
      status_funil: sale.stage,
      historico: [
        {
          id: 1,
          acao: 'venda.status_atualizado',
          status_anterior: 'entrega',
          status_novo: 'concluido',
          created_at: '2026-09-14 13:30:00',
          usuario: { nome: 'Thayara' }
        },
        {
          id: 2,
          acao: 'venda.prioridade_atualizada',
          status_anterior: 'concluido',
          status_novo: 'concluido',
          created_at: '2026-09-15 13:30:00',
          usuario: { nome: 'Outro usuário' }
        },
        {
          id: 3,
          acao: 'venda.status_atualizado',
          status_anterior: 'entrega',
          status_novo: 'concluido',
          created_at: '2026-09-16 13:30:00',
          invalidated_at: '2026-09-16 14:00:00',
          usuario: { nome: 'Automação inválida' }
        }
      ]
    });

    render(
      <SaleModal
        sale={sale}
        stages={[{ id: 'concluido', name: 'Concluído', etapaFinal: true }]}
        stageLabels={{ concluido: 'Concluído' }}
        onClose={vi.fn()}
        onUpdateSale={vi.fn()}
        onUpdatePossuiDocNaCasa={vi.fn()}
        onCancelSale={vi.fn()}
        onReverterCancelamento={vi.fn()}
        finalizada
      />
    );

    expect(screen.getByText('CONCLUÍDA EM')).toBeInTheDocument();
    expect(screen.getByText('CONCLUÍDA POR')).toBeInTheDocument();
    expect(await screen.findByText(/14\/09\/26/)).toBeInTheDocument();
    expect(screen.getByText('Thayara')).toBeInTheDocument();
    expect(screen.queryByText(/15\/09\/26/)).not.toBeInTheDocument();
    expect(screen.queryByText(/16\/09\/26/)).not.toBeInTheDocument();
    expect(screen.queryByText('Outro usuário')).not.toBeInTheDocument();
    expect(screen.queryByText('Automação inválida')).not.toBeInTheDocument();
  });

  it('destaca no modo automacoes a etapa real divergente', () => {
    renderCard(criarSale({
      stage: 'entrega',
      statusFunilReal: 'aceite',
      divergenteAutomacao: true
    }), {
      modoAutomacoes: true,
      stageLabels: { entrega: 'Entrega', aceite: 'Aceite' }
    });

    expect(screen.getByText('Divergente')).toBeInTheDocument();
    expect(screen.getByText(/Real: Aceite/)).toBeInTheDocument();
    expect(screen.queryByTitle('Gerar corpo de email')).not.toBeInTheDocument();
  });

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
      operator: 'Claro',
      aceiteConcluido: false,
      biometriaConcluida: true
    }));

    expect(screen.queryByRole('button', { name: 'Aceite' })).not.toBeInTheDocument();

    rerender(
      <SaleCard
        sale={criarSale({ operator: 'Claro', aceiteConcluido: false, biometriaConcluida: true })}
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
    expect(screen.getByLabelText('Conclusão de Aceite e Biometria')).toBeInTheDocument();
  });

  it.each(['Vivo', 'TIM'])('exibe somente Aceite para venda %s', operator => {
    renderCard(criarSale({ operator, aceiteConcluido: false, biometriaConcluida: true }), {
      aceiteBiometria: true
    });

    expect(screen.getByRole('button', { name: 'Aceite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Biometria' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Conclusão de Aceite')).toBeInTheDocument();
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

    renderCard(criarSale({ operator: 'Claro' }), {
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
    renderCard(criarSale({ operator: 'Claro', canceladaEm: '2026-08-28' }), { aceiteBiometria: true });

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

  it('exige e envia observacao normalizada ao movimentar para outra etapa', async () => {
    const user = userEvent.setup();
    const onUpdateSale = vi.fn().mockResolvedValue(undefined);
    const sale = criarSale({ stage: 'analise', historico: [] });
    api.buscarVendaPorId.mockResolvedValue({ id: sale.id, status_funil: sale.stage, historico: [] });

    render(
      <SaleModal
        sale={sale}
        stages={[{ id: 'analise', name: 'Análise' }, { id: 'entrega', name: 'Entrega' }]}
        stageLabels={{ analise: 'Análise', entrega: 'Entrega' }}
        onClose={vi.fn()}
        onUpdateSale={onUpdateSale}
        onUpdatePossuiDocNaCasa={vi.fn()}
        onCancelSale={vi.fn()}
        onReverterCancelamento={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Atualizar status' }));
    await user.click(screen.getByRole('button', { name: 'Entrega' }));

    const confirmar = screen.getByRole('button', { name: 'Confirmar mudança' });
    expect(screen.getByText('Observação (obrigatória)')).toBeInTheDocument();
    expect(confirmar).toBeEnabled();

    await user.click(confirmar);
    expect(screen.getByText('É obrigatório escrever uma observação para movimentar a venda no funil.')).toBeInTheDocument();
    expect(onUpdateSale).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('Adicione um detalhe sobre essa atualização...'), '  Pedido aprovado  ');
    await user.click(confirmar);

    expect(onUpdateSale).toHaveBeenCalledWith(sale.id, 'entrega', 'media', 'Pedido aprovado', '');
  });

  it('exige observacao mesmo quando o motivo do retorno foi selecionado', async () => {
    const user = userEvent.setup();
    const onUpdateSale = vi.fn().mockResolvedValue(undefined);
    const sale = criarSale({ stage: 'analise', historico: [] });
    api.buscarVendaPorId.mockResolvedValue({ id: sale.id, status_funil: sale.stage, historico: [] });

    render(
      <SaleModal
        sale={sale}
        stages={[{ id: 'analise', name: 'Análise' }]}
        stageLabels={{ analise: 'Análise' }}
        onClose={vi.fn()}
        onUpdateSale={onUpdateSale}
        onUpdatePossuiDocNaCasa={vi.fn()}
        onCancelSale={vi.fn()}
        onReverterCancelamento={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Atualizar status' }));
    await user.click(screen.getByRole('button', { name: 'Marcar como retorno' }));
    await user.click(screen.getByRole('button', { name: 'Cliente recusou' }));

    const confirmar = screen.getByRole('button', { name: 'Confirmar retorno' });
    expect(screen.getByText('Observação (obrigatória)')).toBeInTheDocument();
    expect(confirmar).toBeEnabled();

    await user.click(confirmar);
    expect(screen.getByText('É obrigatório escrever uma observação para movimentar a venda no funil.')).toBeInTheDocument();
    expect(onUpdateSale).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText(/cliente recusou por endereço divergente/i), '  Nova tentativa amanhã  ');
    await user.click(confirmar);

    expect(onUpdateSale).toHaveBeenCalledWith(sale.id, 'retorno', 'media', 'Nova tentativa amanhã', 'Cliente recusou');
  });
});

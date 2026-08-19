import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

import VendaModal from './VendaModal';

const usuario = {
  id: 9,
  ativo: true,
  role: { nome: 'usuario', permissoes: {} },
  permissoes: {
    vendas_ver_todas: true,
    vendas_permitir_reversoes: true
  }
};

function renderModal(overrides = {}) {
  return render(
    <VendaModal
      venda={{
        id: 7,
        nome: 'Cliente corrigido',
        cliente_id: 3,
        vendedora_id: 9,
        vendedoras: [{ id: 9, nome: 'Consultora' }],
        updated_at: '2026-08-13 12:00:00',
        reversoes: [{
          id: 21,
          numero: 1,
          observacao: 'Correção solicitada pelo cliente.',
          created_at: '2026-08-13 12:00:00',
          usuario: { id: 9, nome: 'Consultora' },
          alteracoes: [{ campo: 'nome', anterior: 'Cliente antigo', novo: 'Cliente corrigido' }]
        }],
        campos_com_reversao: ['nome']
      }}
      clientes={[{ id: 3, nome: 'Cliente corrigido' }]}
      vendedoras={[{ id: 9, nome: 'Consultora' }]}
      operadoras={[]}
      tiposVenda={[]}
      servicos={[]}
      vendasPorCliente={new Map()}
      usuarioLogado={usuario}
      podeRegistrarReversao
      modoEdicao={false}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onSaveReversal={vi.fn()}
      {...overrides}
    />
  );
}

describe('VendaModal - reversões', () => {
  it('mostra a trilha existente e libera o modo de reversão pelo botão amarelo', async () => {
    renderModal();

    expect(screen.getByText('Reversão 1')).toBeInTheDocument();
    expect(screen.getByText('Correção solicitada pelo cliente.')).toBeInTheDocument();
    expect(screen.getByText(/13\/08\/2026.*09:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Registrar Reversão/i }));

    expect(await screen.findByLabelText(/Nova observação de reversão/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar reversão/i })).toBeInTheDocument();
  }, 10000);

  it('permite ao vendedor registrar reversão em venda enviada ao pós-venda sem liberar a edição comum', async () => {
    const onSaveReversal = vi.fn().mockResolvedValue({});
    renderModal({
      venda: {
        id: 7,
        nome: 'Cliente corrigido',
        razao_social: 'Empresa original',
        cliente_id: 3,
        vendedora_id: 9,
        vendedoras: [{ id: 9, nome: 'Consultora' }],
        servico_id: 4,
        cliente_solicitou_servicos: ['nenhum_servico'],
        enviada_pos_venda_em: '2026-08-13 11:00:00',
        updated_at: '2026-08-13 12:00:00',
        reversoes: []
      },
      servicos: [{ id: 4, nome: 'Móvel' }],
      usuarioLogado: {
        ...usuario,
        permissoes: { ...usuario.permissoes, vendas_editar: true }
      },
      onSaveReversal
    });

    const botaoReversao = screen.getByRole('button', { name: /Registrar Reversão/i });
    expect(botaoReversao).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Editar venda/i })).not.toBeInTheDocument();

    fireEvent.click(botaoReversao);
    fireEvent.change(screen.getByDisplayValue('Empresa original'), { target: { value: 'Empresa corrigida' } });
    fireEvent.change(await screen.findByLabelText(/Nova observação de reversão/i), { target: { value: 'Correção auditada.' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar reversão/i }));

    await waitFor(() => expect(onSaveReversal).toHaveBeenCalledWith(
      expect.objectContaining({ razao_social: 'Empresa corrigida' }),
      'Correção auditada.',
      '2026-08-13 12:00:00'
    ));
  }, 10000);

  it('não mostra um traço para um registro antigo que não possui data', () => {
    renderModal({
      venda: {
        id: 7,
        nome: 'Cliente corrigido',
        cliente_id: 3,
        vendedora_id: 9,
        vendedoras: [{ id: 9, nome: 'Consultora' }],
        reversoes: [{
          id: 21,
          numero: 1,
          observacao: 'Correção solicitada pelo cliente.'
        }]
      }
    });

    const card = screen.getByText('Reversão 1').closest('article');

    expect(card).not.toHaveTextContent('-');
    expect(card.querySelector('time')).not.toBeInTheDocument();
  });

  it('exige permissao e motivo para excluir uma reversao', async () => {
    const onDeleteReversal = vi.fn().mockResolvedValue({});
    const { rerender } = renderModal();

    expect(screen.queryByRole('button', { name: /Excluir Reversão 1/i })).not.toBeInTheDocument();

    rerender(
      <VendaModal
        venda={{
          id: 7,
          nome: 'Cliente corrigido',
          cliente_id: 3,
          vendedora_id: 9,
          vendedoras: [{ id: 9, nome: 'Consultora' }],
          reversoes: [{
            id: 21,
            numero: 1,
            observacao: 'Correção solicitada pelo cliente.',
            created_at: '2026-08-13 12:00:00',
            alteracoes: []
          }]
        }}
        clientes={[{ id: 3, nome: 'Cliente corrigido' }]}
        vendedoras={[{ id: 9, nome: 'Consultora' }]}
        operadoras={[]}
        tiposVenda={[]}
        servicos={[]}
        vendasPorCliente={new Map()}
        usuarioLogado={usuario}
        podeExcluirReversao
        modoEdicao={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveReversal={vi.fn()}
        onDeleteReversal={onDeleteReversal}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Excluir Reversão 1/i }));
    const confirmar = screen.getByRole('button', { name: /^Excluir reversão$/i });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Motivo da exclusão/i), { target: { value: 'Registro duplicado' } });
    fireEvent.click(confirmar);

    await waitFor(() => expect(onDeleteReversal).toHaveBeenCalledWith(21, 'Registro duplicado'));
  });

  it('abre o histórico permanente ao lado de campo alterado', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Ver histórico de Nome/i }));

    await waitFor(() => expect(screen.getByText('Valor anterior')).toBeInTheDocument());
    expect(screen.getByText('Cliente antigo')).toBeInTheDocument();
    expect(screen.getAllByText('Cliente corrigido').length).toBeGreaterThan(0);
  });

  it('mostra alterações de chips com nomes amigáveis em vez de JSON', async () => {
    renderModal({
      operadoras: [{ id: 2, nome: 'TIM' }],
      venda: {
        id: 7,
        nome: 'Cliente corrigido',
        cliente_id: 3,
        vendedora_id: 9,
        vendedoras: [{ id: 9, nome: 'Consultora' }],
        valores_unitarios_chips: [{ quantidade: 2, gb: '1', valor_unitario: 0.01, tipo_linha: 'novo', operadora_atual_id: 2 }],
        reversoes: [{
          id: 22,
          numero: 2,
          observacao: 'Quantidade corrigida.',
          created_at: '2026-08-13 13:00:00',
          usuario: { id: 9, nome: 'Consultora' },
          alteracoes: [{
            campo: 'valores_unitarios_chips',
            anterior: [{ quantidade: 1, gb: '1', valor_unitario: 0.01, tipo_linha: 'novo', operadora_atual_id: 2 }],
            novo: [{ quantidade: 2, gb: '1', valor_unitario: 0.01, tipo_linha: 'novo', operadora_atual_id: 2 }]
          }]
        }],
        campos_com_reversao: ['valores_unitarios_chips']
      }
    });

    fireEvent.click(screen.getByRole('button', { name: /Ver histórico de Chips, gigas e valores unitários/i }));

    expect(await screen.findByText('Linha 1')).toBeInTheDocument();
    expect(screen.getByText('1 dado alterado')).toBeInTheDocument();
    expect(screen.getAllByText('Quantidade').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 chip').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 chips').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TIM').length).toBeGreaterThan(0);
    expect(screen.queryByText(/operadora_atual_id/)).not.toBeInTheDocument();
  });
});

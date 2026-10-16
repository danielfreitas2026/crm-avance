import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn(() => new Promise(() => {}))
}));
vi.mock('./VendaProblemaPanel', () => ({ default: () => <div>Problemas</div> }));

import VendaModal from './VendaModal';

const venda = { id: 7, cliente_id: 3, vendedora_id: 9, vendedoras: [{ id: 9, nome: 'Consultora' }] };

function renderModal({ permissoes = { vendas_ver_proprias: true }, ...props } = {}) {
  const onSendToPosVenda = vi.fn().mockResolvedValue({});
  render(<VendaModal
    venda={venda}
    clientes={[]}
    vendedoras={[]}
    operadoras={[]}
    tiposVenda={[]}
    servicos={[]}
    vendasPorCliente={new Map()}
    usuarioLogado={{ id: 9, ativo: true, role: { nome: 'usuario' }, permissoes }}
    modoEdicao={false}
    onClose={vi.fn()}
    onSave={vi.fn()}
    onSendToPosVenda={onSendToPosVenda}
    {...props}
  />);
  return onSendToPosVenda;
}

describe('VendaModal - envio sem permissão de edição', () => {
  it.each([
    ['própria', { vendas_ver_proprias: true }, venda],
    ['criada pelo usuário', { vendas_ver_proprias: true }, { ...venda, vendedora_id: 10, criado_por_id: 9 }],
    ['compartilhada', { ver_vendas_compartilhadas: true }, { ...venda, vendedora_id: 10 }],
    ['de terceiros', { vendas_ver_todas: true }, { ...venda, vendedora_id: 10, vendedoras: [{ id: 10 }] }]
  ])('permite enviar venda %s sem liberar edição', async (_nome, permissoes, vendaAtual) => {
    const enviar = renderModal({ permissoes, venda: vendaAtual });
    expect(screen.queryByRole('button', { name: 'Editar venda' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para o pós-venda' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledWith(vendaAtual, {}));
  });

  it.each([
    ['sem acesso', { permissoes: {} }],
    ['fora do escopo próprio', { venda: { ...venda, vendedora_id: 10 } }],
    ['já enviada', { venda: { ...venda, enviada_pos_venda_em: '2026-10-07 10:00:00' } }],
    ['em edição', { modoEdicao: true }],
    ['nova', { venda: null }],
    ['aba problema', { initialTab: 'problema' }],
    ['aba cancelamento', { initialTab: 'cancelamento', venda: { ...venda, cancelada_em: '2026-10-07 10:00:00' } }]
  ])('oculta o botão quando %s', (_nome, props) => {
    renderModal(props);
    expect(screen.queryByRole('button', { name: 'Enviar para o pós-venda' })).not.toBeInTheDocument();
  });

  it('mantém o texto Aprovar no fluxo de aprovações', async () => {
    const enviar = renderModal({ sendToPosVendaLabel: 'Aprovar' });
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(enviar).toHaveBeenCalledWith(venda, {}));
  });

  it('mantém a solicitação de liberação para venda compartilhada', () => {
    const enviar = renderModal({ venda: { ...venda, vendedoras: [...venda.vendedoras, { id: 10, nome: 'Outra' }] } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para o pós-venda' }));
    expect(enviar).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Venda compartilhada entre Consultora e Outra.')).toBeInTheDocument();
  });
});

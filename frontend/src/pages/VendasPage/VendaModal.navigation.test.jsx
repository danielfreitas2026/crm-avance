import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VendaModal from './VendaModal';

vi.mock('../../services/config.service', async original => ({ ...(await original()), listarEtapasFunil: vi.fn().mockResolvedValue([]) }));
vi.mock('../../components/NotasEntidadeTab', () => ({ default: () => <div>Notas atuais do registro</div> }));
vi.mock('./VendaProblemaPanel', () => ({ default: () => <div>Problemas</div> }));

function view(props = {}) {
  return <VendaModal venda={{ id: 7, cliente_id: 3, vendedoras: [] }} clientes={[]} vendedoras={[]} operadoras={[]}
    tiposVenda={[]} servicos={[]} vendasPorCliente={new Map()}
    usuarioLogado={{ id: 9, role: { nome: 'admin' }, permissoes: {} }} modoEdicao={false}
    onClose={vi.fn()} onSave={vi.fn()} {...props} />;
}

describe('navegação nas abas do detalhe de venda', () => {
  beforeEach(() => localStorage.setItem('usuario', '{"id":9}'));
  it('retoma Notas após remontar e comunica a seleção ao consumidor', async () => {
    const onTabChange = vi.fn();
    const first = render(view({ onTabChange }));
    fireEvent.click(screen.getByRole('button', { name: /Notas/ }));
    expect(onTabChange).toHaveBeenCalledWith('notas');
    first.unmount();
    render(view());
    expect(screen.getByRole('button', { name: /Notas/ })).toHaveClass('active');
    expect(await screen.findByText('Notas atuais do registro')).toBeInTheDocument();
  });
  it('prioriza uma aba explícita e rejeita Documentos sem permissão', () => {
    sessionStorage.setItem('crm:navegacao:v1:9:venda-modal:/:7', '"arquivos"');
    const first = render(view());
    expect(screen.queryByRole('button', { name: /Documentos/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Venda', exact: true })).toHaveClass('active');
    first.unmount();
    sessionStorage.setItem('crm:navegacao:v1:9:venda-modal:/:7', '"problema"');
    render(view({ initialTab: 'notas' }));
    expect(screen.getByRole('button', { name: /Notas/ })).toHaveClass('active');
  });
});

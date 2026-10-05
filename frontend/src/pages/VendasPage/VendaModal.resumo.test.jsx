import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([])
}));

vi.mock('./VendaProblemaPanel', () => ({
  default: () => <div>Fluxo de problemas isolado</div>
}));

import VendaModal from './VendaModal';

const vendaResumo = {
  id: 7,
  visao_resumida_consultora: true,
  razao_social: 'Empresa Teste Ltda',
  cnpj: '12345678000190',
  data_venda: '2026-08-19',
  concluida: false,
  valor_total: 119.8,
  vendedoras: [{ nome: 'Ana' }, { nome: 'Bia' }],
  chips: [{
    quantidade: 2,
    gb: '30',
    tipo_linha: 'portabilidade',
    operadora_atual: 'TIM',
    operadora_destino: 'Claro',
    valor_unitario: 59.9,
    subtotal: 119.8
  }]
};

function renderModal(overrides = {}) {
  return render(
    <VendaModal
      venda={vendaResumo}
      clientes={[]}
      vendedoras={[]}
      operadoras={[]}
      tiposVenda={[]}
      servicos={[]}
      vendasPorCliente={new Map()}
      usuarioLogado={{ id: 9, ativo: true, role: { nome: 'usuario' }, permissoes: {} }}
      modoEdicao={false}
      onClose={vi.fn()}
      onSave={vi.fn()}
      {...overrides}
    />
  );
}

function criarChips(quantidade) {
  return Array.from({ length: quantidade }, (_, index) => ({
    quantidade: index + 1,
    gb: String(10 * (index + 1)),
    tipo_linha: index === 0 ? 'portabilidade' : 'novo',
    operadora_atual: index === 0 ? 'TIM' : 'Claro',
    operadora_destino: 'Claro',
    valor_unitario: 10,
    subtotal: 10 * (index + 1)
  }));
}

describe('VendaModal - resumo protegido da consultora', () => {
  it('mostra somente os dados comerciais permitidos', () => {
    renderModal();

    const modal = screen.getByRole('dialog', { name: 'Resumo da venda' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(modal).toHaveTextContent('ID da venda: 7');
    expect(modal).toHaveTextContent('Empresa Teste Ltda');
    expect(modal).toHaveTextContent('12.345.678/0001-90');
    expect(modal).toHaveTextContent('19/08/2026');
    expect(modal).toHaveTextContent('Ana, Bia');
    expect(modal).toHaveTextContent('Venda ainda não concluída');
    expect(modal).toHaveTextContent('2 chips');
    expect(modal).toHaveTextContent('30 GB');
    expect(modal).toHaveTextContent('Portabilidade');
    expect(modal).toHaveTextContent('TIM');
    expect(modal).toHaveTextContent('Claro');
    expect(modal).toHaveTextContent('2 × R$ 59,90');
    expect(modal).toHaveTextContent('R$ 59,90');
    expect(modal).toHaveTextContent('R$ 119,80');
    expect(modal.querySelector('.venda-resumo-consultora__chip-card')).toBeInTheDocument();
    expect(modal.querySelector('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar venda/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar Reversão/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Documentos')).not.toBeInTheDocument();
    expect(screen.queryByText('Notas')).not.toBeInTheDocument();
    expect(screen.queryByText('Representante Legal (RL)')).not.toBeInTheDocument();
  });

  it('consolida operadoras iguais sem repetir a rota', () => {
    renderModal({
      venda: {
        ...vendaResumo,
        chips: [{ ...vendaResumo.chips[0], tipo_linha: 'novo', operadora_atual: 'Claro', operadora_destino: 'claro' }]
      }
    });

    const operador = screen.getByLabelText('Operadora claro');
    expect(operador).toHaveTextContent('Operadoraclaro');
    expect(screen.queryByLabelText('Rota entre operadoras')).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4])('organiza %i grupo(s) no resumo comercial', quantidade => {
    renderModal({ venda: { ...vendaResumo, chips: criarChips(quantidade) } });

    const lista = screen.getByText('Chips e valores vendidos').nextElementSibling;
    expect(lista).toHaveAttribute('data-count', String(quantidade));
    expect(lista.querySelectorAll('.venda-resumo-consultora__chip-card')).toHaveLength(quantidade);
    expect(lista).not.toHaveClass('has-overflow');
  });

  it('mantem rolagem defensiva acima de quatro grupos', () => {
    renderModal({ venda: { ...vendaResumo, chips: criarChips(5) } });

    expect(screen.getByText('Chips e valores vendidos').nextElementSibling).toHaveClass('has-overflow');
  });

  it('abre problemas em fluxo isolado sem restaurar o formulario', () => {
    renderModal({ initialTab: 'problema', initialProblemaId: 4 });

    expect(screen.getByRole('dialog', { name: 'Problemas da venda' })).toHaveTextContent('Fluxo de problemas isolado');
    expect(screen.queryByText('Documentos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar Reversão/i })).not.toBeInTheDocument();
  });
});

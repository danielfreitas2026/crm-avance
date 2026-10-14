import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dddValido, dddsPorLinha } from './venda-ddd';

vi.mock('../../services/config.service', async importOriginal => ({
  ...(await importOriginal()),
  listarEtapasFunil: vi.fn().mockResolvedValue([{ codigo: 'ativa', nome: 'Ativa', etapa_final: true }])
}));

import VendaModal from './VendaModal';

const chip = { quantidade: 1, gb: '25', valor_unitario: 30, tipo_linha: 'novo' };
const venda = {
  id: 7, nome: 'Cliente', cliente_id: 3, vendedora_id: 9,
  servico_id: 1, data_venda: '2026-08-01', quantidade_linhas: 4,
  cliente_solicitou_servicos: ['nenhum_servico'],
  valores_unitarios_chips: [{ ...chip, ddd: '11' }, { ...chip, ddd: '21' }]
};

function abrir(dados = venda, overrides = {}) {
  const onSave = vi.fn().mockResolvedValue({});
  const result = render(<VendaModal
    venda={dados}
    clientes={[{ id: 3, nome: 'Cliente' }]}
    vendedoras={[{ id: 9, nome: 'Consultora' }]}
    operadoras={[]}
    tiposVenda={[]}
    servicos={[{ id: 1, nome: 'Móvel' }]}
    vendasPorCliente={new Map()}
    usuarioLogado={{ id: 9, ativo: true, role: { nome: 'admin' }, permissoes: {} }}
    modoEdicao
    onClose={vi.fn()}
    onSave={onSave}
    {...overrides}
  />);
  return { ...result, onSave };
}

function camposDdd() {
  return screen.getAllByRole('textbox', { name: 'DDD', exact: true });
}

describe('DDD nos blocos de chips', () => {
  it('limita a entrada monetária sem truncar valores colados ou alterar o valor anterior', () => {
    abrir();
    const input = screen.getAllByRole('textbox', { name: 'Valor unit.' })[0];
    fireEvent.change(input, { target: { value: '999999999999' } });
    expect(input).toHaveValue('9.999.999.999,99');
    fireEvent.change(input, { target: { value: '9999999999999' } });
    expect(input).toHaveValue('9.999.999.999,99');
    fireEvent.change(input, { target: { value: '434343434343425000000000000' } });
    expect(input).toHaveValue('9.999.999.999,99');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'R$ 1.234,56' } });
    expect(input).toHaveValue('1.234,56');
    fireEvent.change(input, { target: { value: '000000000000001' } });
    expect(input).toHaveValue('0,01');
  });

  it('organiza cada bloco em identificação, operadoras e valores sem alterar os cálculos', () => {
    const { container } = abrir();
    const bloco = container.querySelector('.chip-item-row');
    const linhas = within(bloco).getByRole('group', { name: 'Linhas e DDD' });
    expect(within(linhas).getByRole('spinbutton', { name: 'Chips' })).toHaveValue(1);
    expect(within(linhas).getByRole('textbox', { name: 'GB', exact: true })).toHaveValue('25');
    expect(within(linhas).getByRole('textbox', { name: 'DDD', exact: true })).toHaveValue('11');
    expect(within(linhas).getByTitle('Remover item')).toBeInTheDocument();
    const operadoras = within(bloco).getByRole('group', { name: 'Operadoras do bloco' });
    expect(within(operadoras).getByText('Operadora atual')).toBeInTheDocument();
    expect(within(operadoras).getByText('Vai para operadora')).toBeInTheDocument();
    const valores = within(bloco).getByRole('group', { name: 'Valores do bloco' });
    expect(within(valores).getByText('Subtotal')).toBeVisible();
    expect(within(valores).getByText('R$ 30,00')).toBeInTheDocument();
    fireEvent.change(within(valores).getByRole('textbox', { name: 'Valor unit.' }), { target: { value: '4500' } });
    expect(within(valores).getByText('R$ 45,00')).toBeInTheDocument();
    expect(within(bloco).getAllByRole('group').map(grupo => grupo.getAttribute('aria-label')))
      .toEqual(['Linhas e DDD', 'Operadoras do bloco', 'Valores do bloco']);
  });

  it('mantém tipo de linha e vendedora em um grupo próprio quando necessários', () => {
    const { container } = abrir({ ...venda,
      vendedoras: [{ id: 9, nome: 'Consultora' }, { id: 10, nome: 'Segunda consultora' }],
      tipos_servico: ['novo', 'portabilidade']
    }, { vendedoras: [{ id: 9, nome: 'Consultora' }, { id: 10, nome: 'Segunda consultora' }] });
    const bloco = container.querySelector('.chip-item-row');
    const opcoes = within(bloco).getByRole('group', { name: 'Tipo e responsável' });
    expect(within(opcoes).getByText('Tipo')).toBeInTheDocument();
    expect(within(opcoes).getByText('Vendedora')).toBeInTheDocument();
    expect(within(bloco).getAllByRole('group').map(grupo => grupo.getAttribute('aria-label')))
      .toEqual(['Linhas e DDD', 'Operadoras do bloco', 'Tipo e responsável', 'Valores do bloco']);
  });

  it('valida DDD opcional e expande por quantidade e tipo', () => {
    expect(dddValido('')).toBe(true);
    expect(dddValido('11')).toBe(true);
    for (const valor of ['1', '20', '111', 'ab']) expect(dddValido(valor)).toBe(false);
    const itens = [{ ...chip, quantidade: 2, ddd: '11' }, { ...chip, ddd: '21', tipo_linha: 'portabilidade' }];
    expect(dddsPorLinha(itens)).toEqual(['11', '11', '21']);
    expect(dddsPorLinha(itens, true)).toEqual(['21']);
  });

  it('exibe DDD por bloco, remove o campo geral e mantém DDDs independentes ao adicionar e remover', () => {
    abrir();
    expect(screen.queryByText('Qual DDD')).not.toBeInTheDocument();
    expect(camposDdd().map(input => input.value)).toEqual(['11', '21']);
    fireEvent.change(camposDdd()[1], { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar chip/i }));
    expect(camposDdd().map(input => input.value)).toEqual(['11', '31', '']);
    fireEvent.change(camposDdd()[2], { target: { value: '41' } });
    const linha = camposDdd()[0].closest('.chip-item-row');
    fireEvent.click(within(linha).getByTitle('Remover item'));
    expect(camposDdd().map(input => input.value)).toEqual(['31', '41']);
    expect(camposDdd()[0]).toHaveAttribute('maxlength', '2');
    expect(camposDdd()[0]).toHaveAttribute('inputmode', 'numeric');
  });

  it.each([
    [{ ...chip }, { ...chip, ddd: '21' }, { ...chip, ddd: '' }],
    JSON.stringify([{ ...chip }, { ...chip, ddd: '21' }, { ...chip, ddd: '' }])
  ])('reabre venda antiga sem sobrescrever DDDs explícitos (%j)', itens => {
    abrir({ ...venda, ddd: '31', valores_unitarios_chips: itens });
    expect(camposDdd().map(input => input.value)).toEqual(['31', '21', '']);
  });

  it('reabre o formato legado de chips em texto', () => {
    abrir({ ...venda, ddd: '31', valores_unitarios_chips: '2x30,00' });
    expect(camposDdd()[0]).toHaveValue('31');
  });

  it('salva os DDDs e deriva o legado do primeiro bloco preenchido', async () => {
    const { container, onSave } = abrir({ ...venda, quantidade_linhas: 2 });
    fireEvent.change(camposDdd()[0], { target: { value: '' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.valores_unitarios_chips.map(item => item.ddd)).toEqual(['', '21']);
    expect(payload.ddd).toBe('21');
    expect(payload.valor_total).toBe(60);
  });

  it('cadastra uma nova venda com vários DDDs', async () => {
    const { container, onSave } = abrir(null, { initialValues: { ...venda, id: undefined, quantidade_linhas: 2 } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.valores_unitarios_chips.map(item => item.ddd)).toEqual(['11', '21']);
    expect(payload.ddd).toBe('11');
  });

  it('mostra a troca de DDD no histórico de reversão dos chips', async () => {
    abrir({ ...venda, reversoes: [{ id: 1, numero: 1, alteracoes: [{
      campo: 'valores_unitarios_chips',
      anterior: [{ ...chip, ddd: '11' }], novo: [{ ...chip, ddd: '21' }]
    }] }], campos_com_reversao: ['valores_unitarios_chips'] });
    fireEvent.click(screen.getByRole('button', { name: /Ver histórico de Chips, gigas e valores unitários/i }));
    expect(await screen.findByText('1 dado alterado')).toBeInTheDocument();
    expect(screen.getByLabelText('Resumo das alterações')).toHaveTextContent('DDD:1121');
  });

  it('impede salvar DDD brasileiro inválido', async () => {
    const { container, onSave } = abrir();
    fireEvent.change(camposDdd()[0], { target: { value: '20' } });
    expect(camposDdd()[0]).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(container.querySelector('form'));
    expect(await screen.findByText(/Informe um DDD brasileiro válido em cada bloco/)).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('preenche números por quantidade e tipo e preserva números completos ao trocar DDD', async () => {
    const { container } = abrir({ ...venda, quantidade_linhas: 3, valores_unitarios_chips: [
      { ...chip, ddd: '11' },
      { ...chip, ddd: '21', quantidade: 2, tipo_linha: 'portabilidade' }
    ], tipos_servico: ['novo', 'portabilidade'], numeros_portados: ['21999990000', ''] });
    const numeros = () => [...container.querySelectorAll('.ported-number-row input')];
    await waitFor(() => expect(numeros().map(input => input.value)).toEqual(['21999990000', '(21) ']));
    fireEvent.change(camposDdd()[1], { target: { value: '31' } });
    expect(numeros().map(input => input.value)).toEqual(['21999990000', '(31) ']);
  });

  it('preenche números ativados na ordem dos blocos', async () => {
    const { container } = abrir({ ...venda, status_funil: 'ativa', data_ativacao: '2026-08-02',
      valores_unitarios_chips: [{ ...chip, ddd: '11', quantidade: 2 }, { ...chip, ddd: '21' }]
    });
    await waitFor(() => expect(container.querySelectorAll('.ported-number-row input')).toHaveLength(3));
    expect([...container.querySelectorAll('.ported-number-row input')].map(input => input.value))
      .toEqual(['(11) ', '(11) ', '(21) ']);
    fireEvent.change(camposDdd()[0], { target: { value: '' } });
    expect([...container.querySelectorAll('.ported-number-row input')].map(input => input.value))
      .toEqual(['', '', '(21) ']);
  });
});

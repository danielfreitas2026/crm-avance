import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCampanhasPage from './AdminCampanhasPage';

const api = vi.hoisted(() => ({
  createCampanha: vi.fn(),
  deleteCampanha: vi.fn(),
  getCampanhas: vi.fn(),
  getParticipantesCampanha: vi.fn(),
  updateCampanhas: vi.fn(),
  listarOperadoras: vi.fn()
}));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/campanha.service', () => ({
  createCampanha: api.createCampanha,
  deleteCampanha: api.deleteCampanha,
  getCampanhas: api.getCampanhas,
  getParticipantesCampanha: api.getParticipantesCampanha,
  updateCampanhas: api.updateCampanhas
}));
vi.mock('../../services/config.service', () => ({ listarOperadoras: api.listarOperadoras }));

const campanhaBase = (overrides = {}) => ({
  id: 10,
  is_gift: true,
  periodo: 'personalizado',
  data_inicio: '2026-08-01',
  data_fim: '2026-08-31',
  periodo_bloqueado: false,
  categoria: 'venda',
  target: 5,
  desc: 'Vendas elegíveis',
  reward: 'Prêmio',
  operadora_ids: [],
  participante_ids: [],
  regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria' }],
  ...overrides
});

describe('AdminCampanhasPage - regras individuais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    api.getCampanhas.mockResolvedValue([campanhaBase()]);
    api.listarOperadoras.mockResolvedValue([{ id: 1, nome: 'Claro' }, { id: 2, nome: 'Vivo' }]);
    api.getParticipantesCampanha.mockResolvedValue([]);
    api.updateCampanhas.mockResolvedValue({});
  });

  it('mostra e leva o foco ate a campanha adicionada', async () => {
    const user = userEvent.setup();
    api.createCampanha.mockResolvedValue(campanhaBase({ id: 11, desc: 'Registrar 1 cliente' }));
    render(<AdminCampanhasPage />);

    await screen.findByText('Regras de elegibilidade');
    await user.click(screen.getByRole('button', { name: /adicionar campanha/i }));

    expect(await screen.findByText('Campanha 2')).toBeInTheDocument();
    const novaCampanha = screen.getByText('Campanha 2').closest('section');
    expect(novaCampanha).toHaveFocus();
    expect(novaCampanha.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('adiciona, configura e salva regras', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);

    await screen.findByText('Regras de elegibilidade');
    await user.click(screen.getByRole('button', { name: /adicionar regra/i }));

    const operadoras = screen.getAllByLabelText('Operadora');
    const publicos = screen.getAllByLabelText('Público');
    const tipos = screen.getAllByLabelText('Tipo considerado');
    expect(operadoras).toHaveLength(2);

    await user.selectOptions(operadoras[1], '2');
    await user.selectOptions(publicos[1], 'nao_base');
    await user.selectOptions(tipos[1], 'portabilidade');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledTimes(1));
    const campanhaSalva = api.updateCampanhas.mock.calls[0][0][0];
    expect(campanhaSalva.regras[1]).toMatchObject({
      operadora_id: 2,
      publico_base: 'nao_base',
      tipo: 'portabilidade'
    });

  });

  it('remove uma regra adicional sem permitir excluir a ultima', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await screen.findByText('Regras de elegibilidade');

    expect(screen.getByRole('button', { name: 'Remover regra 1' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /adicionar regra/i }));
    await user.click(screen.getByRole('button', { name: 'Remover regra 2' }));
    expect(screen.getAllByLabelText('Operadora')).toHaveLength(1);
  });

  it('edita o intervalo e envia datas inclusivas', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    const inicio = await screen.findByLabelText('Data inicial');
    const fim = screen.getByLabelText('Data final');

    await user.clear(inicio);
    await user.type(inicio, '2026-08-10');
    await user.clear(fim);
    await user.type(fim, '2026-08-20');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalled());
    expect(api.updateCampanhas.mock.calls[0][0][0]).toMatchObject({
      data_inicio: '2026-08-10',
      data_fim: '2026-08-20'
    });
  });

  it('bloqueia os calendarios quando ja existe resgate', async () => {
    api.getCampanhas.mockResolvedValue([campanhaBase({ periodo_bloqueado: true })]);
    render(<AdminCampanhasPage />);

    expect(await screen.findByLabelText(/Data inicial/)).toBeDisabled();
    expect(screen.getByLabelText(/Data final/)).toBeDisabled();
    expect(screen.getAllByText('Bloqueada após o primeiro resgate.')).toHaveLength(2);
  });
});

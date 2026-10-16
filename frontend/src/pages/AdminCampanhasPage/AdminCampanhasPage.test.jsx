import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCampanhasPage from './AdminCampanhasPage';

const api = vi.hoisted(() => ({
  createCampanha: vi.fn(),
  deleteCampanha: vi.fn(),
  getCampanhas: vi.fn(),
  getParticipantesCampanha: vi.fn(),
  getVendasExcecaoCampanha: vi.fn(),
  updateCampanhas: vi.fn(),
  listarOperadoras: vi.fn()
}));

vi.mock('../../layouts/LayoutPrivado/LayoutPrivado', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('../../services/campanha.service', () => ({
  createCampanha: api.createCampanha,
  deleteCampanha: api.deleteCampanha,
  getCampanhas: api.getCampanhas,
  getParticipantesCampanha: api.getParticipantesCampanha,
  getVendasExcecaoCampanha: api.getVendasExcecaoCampanha,
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

const expandirPrimeiraCampanha = async user => {
  await user.click(await screen.findByRole('button', { name: 'Expandir' }));
};

describe('AdminCampanhasPage - regras individuais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    api.getCampanhas.mockResolvedValue([campanhaBase()]);
    api.listarOperadoras.mockResolvedValue([{ id: 1, nome: 'Claro' }, { id: 2, nome: 'Vivo' }]);
    api.getParticipantesCampanha.mockResolvedValue([]);
    api.getVendasExcecaoCampanha.mockResolvedValue({ data: [], total: 0 });
    api.updateCampanhas.mockResolvedValue({});
  });

  it.each(['registro_cliente', 'registro_futuro_cliente', 'quantidade_chip', 'outros', 'venda', 'chip_novo', 'portabilidade', 'internet'])('rejeita alvo fracionado na categoria %s e permite corrigir para inteiro', async categoria => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({ categoria, categoria_personalizada: 'Seguro' })]);
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    const alvo = screen.getByLabelText('Alvo');
    expect(alvo).toHaveAttribute('min', '1');
    expect(alvo).toHaveAttribute('step', '1');
    await user.clear(alvo);
    await user.type(alvo, '1.021');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    expect(api.updateCampanhas).not.toHaveBeenCalled();
    expect(screen.getByText(/Alvo deve ser um número inteiro positivo/)).toBeInTheDocument();
    await user.clear(alvo);
    await user.type(alvo, '1021');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledWith([
      expect.objectContaining({ categoria, target: 1021 })
    ]));
  });

  it('permite centavos apenas na categoria monetaria e revalida ao trocar a categoria', async () => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({ categoria: 'valor_monetario', target: 0.01 })]);
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    expect(screen.getByLabelText('Meta (R$)')).toHaveAttribute('min', '0.01');
    expect(screen.getByLabelText('Meta (R$)')).toHaveAttribute('step', '0.01');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledWith([
      expect.objectContaining({ categoria: 'valor_monetario', target: 0.01 })
    ]));
    await screen.findByText('Campanhas atualizadas com sucesso.');
    api.updateCampanhas.mockClear();
    await user.selectOptions(screen.getByLabelText('Categoria'), 'registro_cliente');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    expect(api.updateCampanhas).not.toHaveBeenCalled();
    expect(screen.getByText(/Alvo deve ser um número inteiro positivo/)).toBeInTheDocument();
    expect(screen.getByLabelText('Alvo')).toHaveValue(0.01);
  });

  it('oferece somente as cinco categorias ativas', async () => {
    api.getCampanhas.mockResolvedValue([campanhaBase({ categoria: 'registro_cliente' })]);
    render(<AdminCampanhasPage />);

    const categoria = await screen.findByLabelText('Categoria');
    expect([...categoria.options].map(option => [option.value, option.textContent])).toEqual([
      ['registro_cliente', 'Registro de cliente'],
      ['registro_futuro_cliente', 'Registro de futuro cliente'],
      ['valor_monetario', 'Valor em vendas'],
      ['quantidade_chip', 'Quantidade de chip'],
      ['outros', 'Outro']
    ]);
  });

  it('preserva a categoria legada somente na campanha que ja a utiliza', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    const categoria = await screen.findByLabelText('Categoria');
    expect(categoria).toHaveValue('venda');
    expect([...categoria.options].map(option => option.value)).toEqual([
      'registro_cliente', 'registro_futuro_cliente', 'valor_monetario', 'quantidade_chip', 'outros', 'venda'
    ]);
    expect(screen.getByRole('option', { name: 'Venda' })).toBeInTheDocument();
  });

  it('organiza início e fim em sequência e agrupa categoria e alvo', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    const dataInicial = screen.getByLabelText('Data inicial');
    const horaInicial = screen.getByLabelText('Hora inicial');
    const dataFinal = screen.getByLabelText('Data final');
    const horaFinal = screen.getByLabelText('Hora final');
    expect(dataInicial.compareDocumentPosition(horaInicial) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(horaInicial.compareDocumentPosition(dataFinal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dataFinal.compareDocumentPosition(horaFinal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const categoria = screen.getByLabelText('Categoria');
    expect(categoria.parentElement.parentElement).toBe(screen.getByLabelText('Alvo').parentElement.parentElement);
    expect(screen.queryByText(/\(São Paulo\)/)).not.toBeInTheDocument();
  });

  it('salva futuros clientes com horários e remove exceções de vendas', async () => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({ venda_excecao_ids: [20], vendas_excecao: [{ id: 20 }] })]);
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    await user.selectOptions(screen.getByLabelText('Categoria'), 'registro_futuro_cliente');
    expect(screen.getByLabelText('Público')).toBeDisabled();
    expect(screen.getByLabelText('Tipo considerado')).toBeDisabled();
    expect(screen.getByLabelText('Tipo de chip')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Adicionar exceção/ })).not.toBeInTheDocument();
    const inicio = screen.getByLabelText('Hora inicial');
    const fim = screen.getByLabelText('Hora final');
    await user.type(inicio, '14:00');
    await user.type(fim, '18:00');
    await user.click(screen.getByRole('button', { name: /Salvar alterações/ }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledWith([
      expect.objectContaining({ categoria: 'registro_futuro_cliente', hora_inicio: '14:00', hora_fim: '18:00', venda_excecao_ids: [] })
    ]));
  });

  it('rejeita um único horário', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    await user.type(screen.getByLabelText('Hora inicial'), '14:00');
    await user.click(screen.getByRole('button', { name: /Salvar alterações/ }));
    expect(api.updateCampanhas).not.toHaveBeenCalled();
    expect(screen.getByText('Informe um período válido em todas as campanhas.')).toBeInTheDocument();
  });

  it('bloqueia horários após o primeiro resgate', async () => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({ periodo_bloqueado: true, hora_inicio: '14:00', hora_fim: '18:00' })]);
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
    expect(screen.getByLabelText('Hora inicial')).toBeDisabled();
    expect(screen.getByLabelText('Hora final')).toBeDisabled();
  });

  it('cria novas campanhas com a categoria registro de cliente', async () => {
    const user = userEvent.setup();
    api.createCampanha.mockResolvedValue(campanhaBase({ id: 11, categoria: 'registro_cliente', desc: 'Registrar 1 cliente' }));
    render(<AdminCampanhasPage />);

    await user.click(await screen.findByRole('button', { name: /adicionar campanha/i }));
    expect(api.createCampanha).toHaveBeenCalledWith(expect.objectContaining({ categoria: 'registro_cliente' }));
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

  it('inicia recolhida e permite expandir e recolher uma campanha', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);

    const botaoExpandir = await screen.findByRole('button', { name: 'Expandir' });
    const detalhes = document.getElementById('campanha-detalhes-10');
    expect(botaoExpandir).toHaveAttribute('aria-expanded', 'false');
    expect(detalhes).toHaveAttribute('hidden');

    await user.click(screen.getByRole('heading', { level: 4, name: 'Vendas elegíveis' }));
    const botaoRecolher = screen.getByRole('button', { name: 'Recolher' });
    expect(botaoRecolher).toHaveAttribute('aria-expanded', 'true');
    expect(detalhes).not.toHaveAttribute('hidden');

    await user.click(botaoRecolher);
    expect(screen.getByRole('button', { name: 'Expandir' })).toHaveAttribute('aria-expanded', 'false');
    expect(detalhes).toHaveAttribute('hidden');
  });

  it('edita, salva e mantém o nome da campanha visível no cabeçalho recolhido', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    const nome = await screen.findByLabelText('Nome da campanha');
    expect(screen.getByRole('heading', { level: 4, name: 'Vendas elegíveis' })).toBeInTheDocument();
    expect(screen.queryByText('Configuração da recompensa')).not.toBeInTheDocument();

    await user.clear(nome);
    expect(screen.getByRole('heading', { level: 4, name: 'Campanha 1' })).toBeInTheDocument();

    await user.type(nome, 'Desafio de agosto');
    expect(screen.getByRole('heading', { level: 4, name: 'Desafio de agosto' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recolher' }));
    expect(screen.getByRole('heading', { level: 4, name: 'Desafio de agosto' })).toBeVisible();
    expect(nome).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalled());
    expect(api.updateCampanhas.mock.calls[0][0][0].desc).toBe('Desafio de agosto');
  });

  it('confirma e exclui uma campanha pela propria tela', async () => {
    const user = userEvent.setup();
    api.deleteCampanha.mockResolvedValue(null);
    render(<AdminCampanhasPage />);

    await user.click(await screen.findByRole('button', { name: 'Excluir campanha 1' }));
    expect(screen.getByText('Excluir esta campanha?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sim' }));

    await waitFor(() => expect(api.deleteCampanha).toHaveBeenCalledWith(10));
    expect(screen.queryByText('Campanha 1')).not.toBeInTheDocument();
    expect(screen.getByText('Campanha excluída com sucesso.')).toBeInTheDocument();
  });

  it('separa campanhas encerradas no histórico, mantendo edição sem exclusão', async () => {
    api.getCampanhas.mockResolvedValue([campanhaBase({
      desc: 'Campanha finalizada',
      estado_periodo: 'encerrada'
    })]);
    render(<AdminCampanhasPage />);

    expect(await screen.findByRole('heading', { name: 'Histórico de campanhas' })).toBeInTheDocument();
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da campanha')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Excluir campanha 1' })).not.toBeInTheDocument();
  });

  it('adiciona, configura e salva regras', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    await screen.findByText('Regras de elegibilidade');
    await user.click(screen.getByRole('button', { name: /adicionar regra/i }));

    const operadoras = screen.getAllByLabelText('Operadora');
    const publicos = screen.getAllByLabelText('Público');
    const tiposChip = screen.getAllByLabelText('Tipo de chip');
    expect(operadoras).toHaveLength(2);
    expect(tiposChip[1]).toHaveValue('ambos');

    await user.selectOptions(operadoras[1], '2');
    await user.selectOptions(publicos[1], 'nao_base');
    await user.selectOptions(tiposChip[1], 'portabilidade');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledTimes(1));
    const campanhaSalva = api.updateCampanhas.mock.calls[0][0][0];
    expect(campanhaSalva.regras[1]).toMatchObject({
      operadora_id: 2,
      publico_base: 'nao_base',
      tipo: 'categoria',
      tipo_chip: 'portabilidade'
    });

  });

  it('sincroniza e bloqueia o tipo de chip para tipos considerados restritivos', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);

    const tipoConsiderado = await screen.findByLabelText('Tipo considerado');
    const tipoChip = screen.getByLabelText('Tipo de chip');
    expect(tipoChip).toHaveValue('ambos');
    expect(tipoChip).not.toBeDisabled();

    await user.selectOptions(tipoConsiderado, 'chip_novo');
    expect(tipoChip).toHaveValue('novo');
    expect(tipoChip).toBeDisabled();

    await user.selectOptions(tipoConsiderado, 'portabilidade');
    expect(tipoChip).toHaveValue('portabilidade');
    expect(tipoChip).toBeDisabled();

    await user.selectOptions(tipoConsiderado, 'novo_portabilidade');
    expect(tipoChip).toHaveValue('ambos');
    expect(tipoChip).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledTimes(1));
    expect(api.updateCampanhas.mock.calls[0][0][0].regras[0]).toMatchObject({
      tipo: 'novo_portabilidade',
      tipo_chip: 'ambos'
    });
  });

  it('desabilita o tipo de chip em campanhas de registro de cliente', async () => {
    api.getCampanhas.mockResolvedValue([campanhaBase({
      categoria: 'registro_cliente',
      regras: [{ operadora_id: null, publico_base: 'ambos', tipo: 'categoria', tipo_chip: 'novo' }]
    })]);
    render(<AdminCampanhasPage />);

    const tipoChip = await screen.findByLabelText('Tipo de chip');
    expect(tipoChip).toHaveValue('ambos');
    expect(tipoChip).toBeDisabled();
  });

  it('remove uma regra adicional sem permitir excluir a ultima', async () => {
    const user = userEvent.setup();
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);
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

  it('seleciona varias vendas no modal e persiste somente ao salvar', async () => {
    const user = userEvent.setup();
    api.getVendasExcecaoCampanha.mockResolvedValue({
      data: [
        { id: 101, cliente_nome: 'Empresa A', cnpj: '111', vendedora_nome: 'Ana', data_venda: '2026-07-01', valor_total: 100, quantidade_linhas: 1 },
        { id: 102, cliente_nome: 'Empresa B', cnpj: '222', vendedora_nome: 'Bia', data_venda: '2026-06-01', valor_total: 200, quantidade_linhas: 2 }
      ],
      total: 2
    });
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    await user.click(await screen.findByRole('button', { name: 'Adicionar exceção' }));
    expect(await screen.findByRole('dialog', { name: 'Adicionar exceção' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /#101 · Empresa A/ }));
    await user.click(screen.getByRole('checkbox', { name: /#102 · Empresa B/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar (2)' }));

    expect(screen.queryByRole('dialog', { name: 'Adicionar exceção' })).not.toBeInTheDocument();
    expect(screen.getByText('#101 · Empresa A')).toBeInTheDocument();
    expect(api.updateCampanhas).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalledTimes(1));
    expect(api.updateCampanhas.mock.calls[0][0][0].venda_excecao_ids).toEqual([101, 102]);
  });

  it('indica e permite remover uma excecao que se tornou indisponivel', async () => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({
      venda_excecao_ids: [77],
      vendas_excecao: [{ id: 77, cliente_nome: 'Venda cancelada', valida: false }]
    })]);
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    expect(await screen.findByText(/Indisponível/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover exceção da venda 77' }));
    expect(screen.getByText('Nenhuma venda adicionada como exceção.')).toBeInTheDocument();
  });

  it('busca somente vendas fora da campanha e preserva as excecoes existentes', async () => {
    const user = userEvent.setup();
    api.getCampanhas.mockResolvedValue([campanhaBase({
      venda_excecao_ids: [77],
      vendas_excecao: [{ id: 77, cliente_nome: 'Venda existente', valida: true }]
    })]);
    api.getVendasExcecaoCampanha.mockResolvedValue({
      data: [{ id: 101, cliente_nome: 'Venda nova', valor_total: 100 }],
      total: 1
    });
    render(<AdminCampanhasPage />);
    await expandirPrimeiraCampanha(user);

    await user.selectOptions(await screen.findByLabelText('Categoria'), 'valor_monetario');
    await user.click(await screen.findByRole('button', { name: 'Adicionar exceção' }));
    await waitFor(() => expect(api.getVendasExcecaoCampanha).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        campanha: expect.objectContaining({ categoria: 'valor_monetario' }),
        excluir_ids: [77]
      })
    ));
    expect(screen.queryByRole('checkbox', { name: /Venda existente/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: /Venda nova/ }));
    await user.click(screen.getByRole('button', { name: 'Confirmar (1)' }));
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(api.updateCampanhas).toHaveBeenCalled());
    expect(api.updateCampanhas.mock.calls[0][0][0].venda_excecao_ids).toEqual([77, 101]);
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AdicionarLeadModal,
  AvaliacaoPrimeiraLigacao,
  EscolherDestinoFuturoClienteModal,
  FuturoClienteDetalheModal,
  LeadStatusMailing,
  SeletorEscopoFuturosClientes
} from './FuturosClientesPage';
import { formatarDuracaoMinutos, getClasseLinhaLead, isVendaAntigaRegistrada, isFuturoClienteVendido, isVendaRecusada, resolverAbaFuturosClientes } from './lead-status';
import { montarFiltrosLinhasMailingRecebido } from './mailing-recebido-search';

describe('status de venda recusada no mailing recebido', () => {
  const recusadaAposReversao = {
    futuro_cliente: 0,
    status_operacional: 'perdido',
    venda_recusada_em: '2026-08-13 10:00:00',
    venda_recusada_motivo: 'Cliente nao aprovou a proposta.'
  };

  it('reconhece a recusa sem depender do estado de futuro cliente', () => {
    expect(isVendaRecusada(recusadaAposReversao)).toBe(true);
    expect(getClasseLinhaLead(recusadaAposReversao)).toBe('lead-row-recusado');
  });

  it('exibe o chip e o motivo para uma venda recusada depois da reversao', () => {
    render(<LeadStatusMailing linha={recusadaAposReversao} />);

    expect(screen.getByText('Venda recusada')).toBeVisible();
    expect(screen.getByTitle('Cliente nao aprovou a proposta.')).toBeVisible();
  });

  it('mantem o reconhecimento para um futuro cliente recusado', () => {
    expect(isVendaRecusada({ ...recusadaAposReversao, futuro_cliente: 1 })).toBe(true);
  });

  it('nao confunde cliente recusou com venda recusada em registro legado', () => {
    expect(isVendaRecusada({
      futuro_cliente: 0,
      status_operacional: 'perdido',
      cliente_recusou: 1
    })).toBe(false);
  });
});

describe('avaliação da primeira ligação', () => {
  it('exibe os textos acentuados quando a ligação ainda não foi avaliada', () => {
    render(<AvaliacaoPrimeiraLigacao linha={{}} />);

    expect(screen.getByText('Avaliação da primeira ligação')).toBeVisible();
    expect(screen.getByText('Ainda não avaliada')).toBeVisible();
  });
});

describe('classificação canônica de vendas', () => {
  it('distingue venda antiga da venda originada pelo futuro cliente', () => {
    const antiga = { futuro_cliente: 1, venda_classificacao: { tipo: 'venda_antiga_registrada', venda_id: 7 } };
    const originada = { futuro_cliente: 1, venda_classificacao: { tipo: 'venda_futuro_cliente', venda_id: 8 } };

    expect(isVendaAntigaRegistrada(antiga)).toBe(true);
    expect(isFuturoClienteVendido(antiga)).toBe(false);
    expect(getClasseLinhaLead(antiga)).toBe('lead-row-venda-antiga');
    expect(isFuturoClienteVendido(originada)).toBe(true);
  });

  it('renderiza os dois novos estados sem usar o rótulo genérico', () => {
    const { rerender } = render(<LeadStatusMailing linha={{ venda_classificacao: { tipo: 'venda_antiga_registrada' } }} />);
    expect(screen.getByText('Venda antiga registrada')).toBeVisible();

    rerender(<LeadStatusMailing linha={{ futuro_cliente: 1, venda_classificacao: { tipo: 'venda_futuro_cliente' } }} />);
    expect(screen.getByText('Venda registrada por futuro cliente')).toBeVisible();
  });
});

describe('abas de futuros clientes', () => {
  it('mantém aliases legados e protege a aba administrativa', () => {
    expect(resolverAbaFuturosClientes('futuros')).toBe('meus');
    expect(resolverAbaFuturosClientes('leads')).toBe('mailings');
    expect(resolverAbaFuturosClientes('recebidos')).toBe('recebidos');
    expect(resolverAbaFuturosClientes('estatisticas', false)).toBe('meus');
    expect(resolverAbaFuturosClientes('estatisticas', true)).toBe('estatisticas');
  });

  it('indica de forma acessível qual escopo está selecionado', () => {
    const { rerender } = render(<SeletorEscopoFuturosClientes escopoTodos={false} onChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Meus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<SeletorEscopoFuturosClientes escopoTodos onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Meus' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('busca global nos mailings recebidos', () => {
  it('consulta clientes em todos os mailings sem exigir selecao manual', () => {
    expect(montarFiltrosLinhasMailingRecebido({
      selecionados: [10, 20],
      pagina: 2,
      busca: '',
      buscaGlobal: ' 12.345.678/0001-90 ',
      status: 'pendente',
      linhaId: null
    })).toEqual({
      envio_ids: undefined,
      page: 2,
      page_size: 200,
      busca: undefined,
      busca_global: '12.345.678/0001-90',
      status: 'pendente',
      linha_id: undefined
    });
  });

  it('restaura os mailings selecionados quando a busca global e limpa', () => {
    expect(montarFiltrosLinhasMailingRecebido({
      selecionados: [10, 20],
      pagina: 1,
      busca: 'empresa',
      buscaGlobal: '   ',
      status: '',
      linhaId: null
    })).toMatchObject({
      envio_ids: [10, 20],
      busca: 'empresa',
      busca_global: undefined
    });
  });
});

describe('duração dos indicadores', () => {
  it('resume minutos longos em dias, horas e minutos', () => {
    expect(formatarDuracaoMinutos(42)).toBe('42 min');
    expect(formatarDuracaoMinutos(192)).toBe('3h 12min');
    expect(formatarDuracaoMinutos(12989)).toBe('9d 29min');
    expect(formatarDuracaoMinutos(null)).toBe('-');
  });
});

describe('modal de adição de lead', () => {
  it('permite escolher a carteira ou a distribuição e cancelar sem salvar', () => {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(<EscolherDestinoFuturoClienteModal processando={false} onClose={onClose} onChoose={onChoose} />);

    fireEvent.click(screen.getByRole('button', { name: /Ficar comigo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar para distribuição/i }));
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao formulário/i }));

    expect(onChoose).toHaveBeenNthCalledWith(1, 'carteira');
    expect(onChoose).toHaveBeenNthCalledWith(2, 'distribuicao');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('separa as informações da planilha das ações do usuário', () => {
    render(
      <AdicionarLeadModal
        linha={{ id: 10, dados_json: { 'Razão social': 'Empresa Exemplo' }, envio: { nome: 'Envio teste' } }}
        colunas={[]}
        usuario={{ role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={() => {}}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );

    const modal = screen.getByRole('dialog', { name: 'Adicionar lead' });
    expect(modal.querySelector('.modal-body')).toHaveClass('adicionar-lead-modal__body--opcoes');
    expect(screen.getByRole('region', { name: 'Informações da planilha' })).toContainElement(screen.getByText('Empresa Exemplo'));
    expect(modal.querySelector('.adicionar-lead-acoes')).toContainElement(screen.getByRole('button', { name: /Registrar venda/i }));
  });

  it('mantém os dados e o formulário lado a lado ao registrar futuro cliente', () => {
    render(
      <AdicionarLeadModal
        linha={{ id: 11, dados_json: { 'Razão social': 'Empresa Futura' }, envio: { nome: 'Envio teste' } }}
        colunas={[]}
        usuario={{ role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={() => {}}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Registrar futuro cliente/i }));

    const modal = screen.getByRole('dialog', { name: 'Adicionar lead' });
    expect(modal.querySelector('.modal-body')).toHaveClass('adicionar-lead-modal__body--futuro');
    expect(screen.getByRole('region', { name: 'Informações da planilha' })).toContainElement(screen.getByText('Empresa Futura'));
    expect(screen.getByRole('form', { name: 'Registrar futuro cliente' })).toBeVisible();
  });

  it('abre a escolha no submit e permite voltar com o formulário preservado', () => {
    render(
      <AdicionarLeadModal
        linha={{ id: 12, dados_json: { 'Razão social': 'Empresa preservada' }, envio: { nome: 'Envio teste' } }}
        colunas={[]}
        usuario={{ role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={() => {}}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Registrar futuro cliente/i }));
    const formulario = screen.getByRole('form', { name: 'Registrar futuro cliente' });
    fireEvent.change(within(formulario).getByDisplayValue('Empresa preservada'), { target: { value: 'Empresa editada' } });
    fireEvent.submit(formulario);

    expect(screen.getByRole('dialog', { name: /O que deseja fazer com este futuro cliente/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Voltar ao formulário/i }));
    expect(screen.queryByRole('dialog', { name: /O que deseja fazer com este futuro cliente/i })).not.toBeInTheDocument();
    expect(within(formulario).getByDisplayValue('Empresa editada')).toBeVisible();
  });

  it('mantém o modal do mailing separado dos painéis do detalhe de futuro cliente', () => {
    const { unmount } = render(
      <AdicionarLeadModal
        linha={{ id: 10, dados_json: { 'Razão social': 'Empresa Mailing' }, envio: { nome: 'Envio teste' } }}
        colunas={[]}
        usuario={{ role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={() => {}}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Adicionar lead' })).not.toHaveClass('futuro-cliente-detalhe-modal');
    unmount();

    render(
      <FuturoClienteDetalheModal
        linha={{
          id: 11,
          dados_json: { 'Razão social': 'Empresa da Planilha', CNPJ: '11.111.111/1111-11' },
          envio: { nome: 'Envio futuro' },
          sondagem: {
            razao_social: 'Empresa da Primeira Ligação',
            cnpj: '22.222.222/2222-22',
            contato_nome: 'Contato da ligação',
            chips_itens: [
              { quantidade: 2, preco_por_chip: 39.9 },
              { quantidade: 1, preco_por_chip: 59.9 }
            ],
            usuario: { nome: 'Consultora teste' }
          }
        }}
        onClose={() => {}}
        onAtualizado={() => {}}
        onRegistrarVenda={() => {}}
        somenteLeitura
      />
    );

    const detalhe = screen.getByRole('dialog', { name: 'Detalhes do futuro cliente' });
    const painelPlanilha = screen.getByRole('region', { name: 'Dados da planilha' });
    const painelPrimeiraLigacao = screen.getByRole('region', { name: 'Dados obtidos na 1ª ligação' });
    const formulario = screen.getByRole('region', { name: 'Atualizar dados do futuro cliente' });

    expect(detalhe).toHaveClass('futuro-cliente-detalhe-modal');
    expect(detalhe).not.toHaveClass('adicionar-lead-modal');
    expect(within(painelPlanilha).getByText('Empresa da Planilha')).toBeVisible();
    expect(within(painelPlanilha).queryByText('Empresa da Primeira Ligação')).not.toBeInTheDocument();
    expect(within(painelPrimeiraLigacao).getByText('Empresa da Primeira Ligação')).toBeVisible();
    expect(within(painelPrimeiraLigacao).getByText('Avaliação da primeira ligação')).toBeVisible();
    expect(painelPlanilha.compareDocumentPosition(painelPrimeiraLigacao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(painelPrimeiraLigacao.compareDocumentPosition(formulario) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...formulario.querySelectorAll('.futuro-cliente-form__secao h4')].map(titulo => titulo.textContent)).toEqual([
      'Empresa',
      'Contato',
      'Cenário comercial',
      'Proposta',
      'Observações',
      'Acompanhamento'
    ]);
    expect(within(screen.getByRole('region', { name: 'Empresa' })).getByLabelText('CNPJ')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Contato' })).getByLabelText('Melhor número para contato')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Cenário comercial' })).getByLabelText('Operadora atual')).toBeVisible();
    const proposta = screen.getByRole('region', { name: 'Proposta' });
    const rodapeProposta = proposta.querySelector('.chips-sondagem-footer');
    expect(proposta.querySelectorAll('.chips-sondagem-row')).toHaveLength(2);
    expect(rodapeProposta).toContainElement(screen.getByRole('button', { name: /Adicionar outro valor de chip/i }));
    expect(rodapeProposta).toContainElement(within(proposta).getByText('Média mensal estimada'));
    expect(within(screen.getByRole('region', { name: 'Observações' })).getByLabelText('Anotações comerciais')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Acompanhamento' })).getByLabelText('Data de retorno')).toBeVisible();
    expect(detalhe.querySelector('.futuro-cliente-detalhe__acoes--principais')).toBeInTheDocument();
    expect(detalhe.querySelector('.futuro-cliente-detalhe__acoes--confirmacao')).toContainElement(screen.getByRole('button', { name: 'Cancelar' }));
  });

  it('exibe estados vazios quando as duas origens ainda não possuem dados', () => {
    render(
      <FuturoClienteDetalheModal
        linha={{ id: 12, dados_json: {}, envio: { nome: 'Envio vazio' } }}
        onClose={() => {}}
        onAtualizado={() => {}}
        onRegistrarVenda={() => {}}
        somenteLeitura
      />
    );

    expect(screen.getByText('Nenhum dado disponível na planilha.')).toBeVisible();
    expect(screen.getByText('A primeira ligação ainda não possui dados registrados.')).toBeVisible();
  });

  it('oferece envio posterior somente para futuro cliente novo mantido na carteira', () => {
    localStorage.setItem('usuario', JSON.stringify({ id: 7, role: { nome: 'admin' } }));
    const linha = {
      id: 31,
      atribuido_para_id: 7,
      futuro_cliente_marcado_por_id: 7,
      futuro_cliente_destino: 'carteira',
      dados_json: { 'Razão social': 'Empresa reservada' },
      envio: { nome: 'Envio futuro' },
      sondagem: { chips_itens: [], usuario: { nome: 'Consultora teste' } }
    };
    const props = {
      onClose: () => {},
      onAtualizado: () => {},
      onDistribuido: () => {},
      onRegistrarVenda: () => {}
    };
    const { unmount } = render(<FuturoClienteDetalheModal linha={linha} {...props} />);

    expect(screen.getByRole('button', { name: /Enviar para distribuição/i })).toBeVisible();
    unmount();

    render(<FuturoClienteDetalheModal linha={{ ...linha, futuro_cliente_destino: null }} {...props} />);
    expect(screen.queryByRole('button', { name: /Enviar para distribuição/i })).not.toBeInTheDocument();
    localStorage.removeItem('usuario');
  });
});

describe('ocultação visual de venda registrada no mailing', () => {
  it('mantem o futuro cliente e oculta somente o chip da venda', () => {
    render(<LeadStatusMailing linha={{
      futuro_cliente: 1,
      venda_id: 72,
      status_operacional: 'vendido',
      venda_registrada_oculta: 1
    }} />);

    expect(screen.queryByText(/Venda registrada/)).not.toBeInTheDocument();
    expect(screen.getByText('Futuro cliente')).toBeVisible();
  });
});

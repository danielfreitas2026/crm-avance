import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AdicionarLeadModal,
  AvaliacaoPrimeiraLigacao,
  EscolherDestinoFuturoClienteModal,
  FuturoClienteDetalheModal,
  LeadStatusMailing,
  ResponsavelAtualCard,
  SeletorEscopoFuturosClientes
} from './FuturosClientesPage';
import { resolverAcessoLixeiraFuturosClientes } from './futuros-clientes-lixeira';
import { distribuicaoPermiteAtendimento, formatarDuracaoMinutos, getClasseLinhaLead, getClasseResultadoVenda, isVendaAntigaRegistrada, isFuturoClienteVendido, isVendaRecusada, resolverAbaFuturosClientes } from './lead-status';
import { montarFiltrosLinhasMailingRecebido } from './mailing-recebido-search';
import * as leadPlanilhaService from '../../services/lead-planilha.service';

describe('atendimento de futuro cliente recebido com retorno', () => {
  it('permanece editavel enquanto o retorno agendado pertence a atribuicao aceita', () => {
    expect(distribuicaoPermiteAtendimento({
      status: 'aceito',
      acao_registrada_em: '2026-08-20T12:00:00.000Z',
      acao_registrada_tipo: 'retorno_agendado',
      prazo_acao_em: '2026-08-20T15:30:00.000Z'
    })).toBe(true);

    expect(distribuicaoPermiteAtendimento({
      status: 'aceito',
      acao_registrada_em: '2026-08-20T12:00:00.000Z',
      acao_registrada_tipo: 'cliente_recusou'
    })).toBe(false);
  });
});

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
    expect(getClasseLinhaLead(originada)).toBe('lead-row-vendido');
    expect(getClasseResultadoVenda(originada)).toBe('lead-row-vendido');
    expect(getClasseResultadoVenda({
      ...originada,
      venda_recusada_em: '2026-08-19 10:00:00'
    })).toBe('lead-row-vendido');
    expect(getClasseResultadoVenda(antiga)).toBe('');
    expect(getClasseResultadoVenda({ futuro_cliente: 1, futuro_cliente_retorno: '2026-08-20 10:00:00' })).toBe('');
    expect(getClasseResultadoVenda({ futuro_cliente: 1, venda_recusada_em: '2026-08-19 10:00:00' })).toBe('lead-row-recusado');
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
    expect(resolverAbaFuturosClientes('consultoras', false, false)).toBe('meus');
    expect(resolverAbaFuturosClientes('consultoras', false, true)).toBe('consultoras');
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

describe('permissoes da lixeira de futuros clientes', () => {
  const usuario = permissoes => ({ ativo: true, role: { nome: 'usuario', permissoes } });

  it('separa envio/restauracao de exclusao definitiva na carteira propria', () => {
    expect(resolverAcessoLixeiraFuturosClientes(usuario({
      futuros_clientes_enviar_lixeira: true
    }))).toEqual({
      podeEnviarLixeira: true,
      podeExcluirDefinitivamente: false,
      podeAcessarLixeira: true
    });

    expect(resolverAcessoLixeiraFuturosClientes(usuario({
      futuros_clientes_excluir_definitivamente: true
    }))).toEqual({
      podeEnviarLixeira: false,
      podeExcluirDefinitivamente: true,
      podeAcessarLixeira: true
    });
  });

  it('exige a permissao complementar para atuar na visao Todos', () => {
    const somenteAcao = usuario({ futuros_clientes_enviar_lixeira: true });
    const acessoGlobal = usuario({
      futuros_clientes_enviar_lixeira: true,
      futuros_clientes_gerenciar_todos: true
    });

    expect(resolverAcessoLixeiraFuturosClientes(somenteAcao, { escopoTodos: true }).podeAcessarLixeira).toBe(false);
    expect(resolverAcessoLixeiraFuturosClientes(acessoGlobal, { escopoTodos: true }).podeEnviarLixeira).toBe(true);
  });

  it('nao oferece a lixeira na aba de encaminhamentos recebidos', () => {
    const acessoCompleto = usuario({
      futuros_clientes_enviar_lixeira: true,
      futuros_clientes_excluir_definitivamente: true,
      futuros_clientes_gerenciar_todos: true
    });

    expect(resolverAcessoLixeiraFuturosClientes(acessoCompleto, { modoRecebidos: true }).podeAcessarLixeira).toBe(false);
  });
});

describe('responsável atual do futuro cliente', () => {
  it('destaca o responsável e identifica etapa, retorno e última devolução', () => {
    render(<ResponsavelAtualCard estadoAtual={{
      responsavel: { nome: 'Natália Rodrigues' },
      etapa: 'Negociação',
      retorno_em: '2026-08-20 15:30:00',
      prazo_em: '2026-08-21 16:00:00',
      ultimo_retorno: { motivo: 'Cliente pediu novo contato.' }
    }} />);

    const nome = screen.getByText('Natália Rodrigues');
    expect(nome.closest('.futuro-cliente-responsavel-card')).not.toHaveClass('futuro-cliente-responsavel-card--sem-responsavel');
    expect(screen.getByText('Negociação')).toBeVisible();
    expect(screen.getByText(/^Retorno:/)).toBeVisible();
    expect(screen.queryByText(/^Prazo:/)).not.toBeInTheDocument();
    expect(screen.getByTitle('Cliente pediu novo contato.')).toHaveTextContent('Última devolução: Cliente pediu novo contato.');
  });

  it('usa alerta âmbar e identifica o prazo quando não há responsável', () => {
    render(<ResponsavelAtualCard estadoAtual={{
      responsavel: null,
      etapa: 'Telegram',
      prazo_em: '2026-08-20 18:00:00'
    }} />);

    const card = screen.getByText('Sem responsável').closest('.futuro-cliente-responsavel-card');
    expect(card).toHaveClass('futuro-cliente-responsavel-card--sem-responsavel');
    expect(screen.getByText('Telegram')).toBeVisible();
    expect(screen.getByText(/^Prazo:/)).toBeVisible();
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

  it('leva os dados mapeados do cliente para os campos reais da venda', () => {
    const onRegistrarVenda = vi.fn();
    render(
      <AdicionarLeadModal
        linha={{
          id: 20,
          atribuido_para_id: 7,
          dados_json: {
            Nome: 'Loja Exemplo',
            'Razão social': 'Loja Exemplo LTDA',
            CNPJ: '12.345.678/0001-95',
            Telefone: '11999998888',
            'E-mail': 'contato@exemplo.com',
            Responsável: 'Maria Silva'
          },
          envio: { nome: 'Envio teste' }
        }}
        colunas={[]}
        usuario={{ id: 7, role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={onRegistrarVenda}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Registrar venda/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar na nova venda/i }));

    expect(onRegistrarVenda).toHaveBeenCalledWith(expect.objectContaining({
      nome: 'Loja Exemplo',
      razao_social: 'Loja Exemplo LTDA',
      cnpj: '12.345.678/0001-95',
      telefone: '11999998888',
      email: 'contato@exemplo.com',
      responsavel_nome: 'Maria Silva',
      nome_representante_legal: 'Maria Silva',
      telefone_representante_legal: '11999998888',
      email_representante_legal: 'contato@exemplo.com',
      nome_fechou_venda: 'RL',
      vendedoras: ['7']
    }));
  });

  it('preenche o administrador com os dados prioritarios da sondagem', () => {
    const onRegistrarVenda = vi.fn();
    render(
      <AdicionarLeadModal
        linha={{
          id: 21,
          futuro_cliente: true,
          atribuido_para_id: 7,
          dados_json: { Responsável: 'Contato do mailing' },
          sondagem: {
            razao_social: 'Empresa da Sondagem',
            cnpj: '12.345.678/0001-95',
            contato_nome: 'Administrador da Sondagem',
            contato_tipo: 'adm',
            whatsapp_ddd: '11',
            whatsapp_numero: '988887777'
          },
          envio: { nome: 'Envio teste' }
        }}
        colunas={[]}
        usuario={{ id: 7, role: { nome: 'admin' } }}
        onClose={() => {}}
        onRegistrarVenda={onRegistrarVenda}
        onFuturoClienteSalvo={() => {}}
        onLinhaAtualizada={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Registrar venda/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continuar na nova venda/i }));

    expect(onRegistrarVenda).toHaveBeenCalledWith(expect.objectContaining({
      razao_social: 'Empresa da Sondagem',
      cnpj: '12.345.678/0001-95',
      responsavel_nome: 'Administrador da Sondagem',
      responsavel_tipo: 'adm',
      nome_administrador: 'Administrador da Sondagem',
      telefone_administrador: '11988887777',
      nome_fechou_venda: 'ADM'
    }));
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

  it('permite ao gerente vincular venda na visao Todos sem liberar a edicao dos dados', () => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: {
        futuros_clientes_ver_todos: true,
        gerenciar_leads: true
      }
    }));

    render(
      <FuturoClienteDetalheModal
        linha={{ id: 13, futuro_cliente: 1, dados_json: {}, sondagem: { chips_itens: [] } }}
        onClose={() => {}}
        onAtualizado={() => {}}
        somenteLeitura
        permitirGerenciarVinculo
      />
    );

    expect(screen.getByRole('button', { name: 'Vincular venda' })).toBeVisible();
    expect(screen.getByLabelText('CNPJ')).toBeDisabled();
    localStorage.removeItem('usuario');
  });

  it('nao permite vincular na visao Todos com permissao apenas de visualizacao', () => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: { futuros_clientes_ver_todos: true }
    }));

    render(
      <FuturoClienteDetalheModal
        linha={{ id: 14, futuro_cliente: 1, dados_json: {}, sondagem: { chips_itens: [] } }}
        onClose={() => {}}
        onAtualizado={() => {}}
        somenteLeitura
        permitirGerenciarVinculo
      />
    );

    expect(screen.queryByRole('button', { name: 'Vincular venda' })).not.toBeInTheDocument();
    localStorage.removeItem('usuario');
  });

  it('permite ao gerente administrar um vinculo existente na visao Todos', () => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: {
        futuros_clientes_ver_todos: true,
        gerenciar_leads: true
      }
    }));

    render(
      <FuturoClienteDetalheModal
        linha={{ id: 15, futuro_cliente: 1, venda_id: 21, dados_json: {}, sondagem: { chips_itens: [] } }}
        onClose={() => {}}
        onAtualizado={() => {}}
        somenteLeitura
        permitirGerenciarVinculo
      />
    );

    expect(screen.getByRole('button', { name: 'Gerenciar vínculo' })).toBeVisible();
    localStorage.removeItem('usuario');
  });

  it('oferece envio posterior somente para futuro cliente novo mantido na carteira', () => {
    localStorage.setItem('usuario', JSON.stringify({ id: 7, role: { nome: 'admin' } }));
    const linha = {
      id: 31,
      futuro_cliente: 1,
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

    const legadoSemEnvio = render(<FuturoClienteDetalheModal linha={{ ...linha, futuro_cliente_destino: null }} {...props} />);
    expect(screen.queryByRole('button', { name: /Enviar para distribuição/i })).not.toBeInTheDocument();
    legadoSemEnvio.unmount();

    render(<FuturoClienteDetalheModal linha={{
      ...linha,
      futuro_cliente_destino: null,
      distribuicao: { id: 91, status: 'expirado_apos_retorno' }
    }} {...props} somenteLeitura permitirReenvioTelegram />);
    expect(screen.getByRole('button', { name: /Retornar ao Telegram/i })).toBeVisible();
    localStorage.removeItem('usuario');
  });

  it('permite retornar na visao completa com retorno marcado e pede confirmacao', async () => {
    const linha = {
      id: 32,
      futuro_cliente: 1,
      atribuido_para_id: 9,
      futuro_cliente_marcado_por_id: 9,
      futuro_cliente_destino: 'distribuicao',
      status_operacional: 'distribuido_venda',
      etapa_atual: 'venda',
      retorno_agendado_em: '2026-08-28 10:00:00',
      distribuicao: { id: 92, status: 'aceito', acao_registrada_tipo: 'retorno_agendado' },
      cliente_id: 72,
      dados_json: { 'Razão social': 'Empresa republicada' },
      envio: { nome: 'Envio futuro' },
      sondagem: { chips_itens: [], usuario: { nome: 'Consultora teste' } }
    };
    const props = {
      linha,
      onClose: () => {},
      onAtualizado: () => {},
      onRegistrarVenda: () => {},
      somenteLeitura: true,
      permitirReenvioTelegram: true
    };

    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      ativo: true,
      permissoes: { futuros_clientes_ver_todos: true }
    }));
    const { unmount } = render(<FuturoClienteDetalheModal {...props} />);
    expect(screen.getByRole('button', { name: /Retornar ao Telegram/i })).toBeVisible();
    unmount();

    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      ativo: true,
      permissoes: {
        futuros_clientes_ver_todos: true,
        futuros_clientes_registrar: true
      }
    }));
    const onDistribuido = vi.fn();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const enviar = vi.spyOn(leadPlanilhaService, 'enviarFuturoClienteParaDistribuicao').mockResolvedValue({ linha });
    render(<FuturoClienteDetalheModal {...props} onDistribuido={onDistribuido} />);

    const botao = screen.getByRole('button', { name: /Retornar ao Telegram/i });
    expect(screen.getByLabelText('CNPJ')).toBeDisabled();
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/desvincular a consultora atual/i));
    expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/retorno marcado será preservado/i));
    expect(enviar).not.toHaveBeenCalled();

    fireEvent.click(botao);
    await waitFor(() => expect(enviar).toHaveBeenCalledWith(32));
    expect(onDistribuido).toHaveBeenCalledWith(linha, true);

    confirmar.mockRestore();
    enviar.mockRestore();
    localStorage.removeItem('usuario');
  });

  it('mostra retorno ao Telegram aguardando aceite e bloqueia estados encerrados', () => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: { futuros_clientes_ver_todos: true }
    }));
    const base = {
      id: 33,
      futuro_cliente: 1,
      futuro_cliente_destino: 'distribuicao',
      dados_json: {},
      sondagem: { chips_itens: [] }
    };
    const props = {
      onClose: () => {},
      onAtualizado: () => {},
      somenteLeitura: true,
      permitirReenvioTelegram: true
    };

    const aguardando = render(<FuturoClienteDetalheModal
      {...props}
      linha={{
        ...base,
        status_operacional: 'distribuido_venda',
        etapa_atual: 'venda',
        distribuicao: { id: 93, status: 'aguardando_aceite' }
      }}
    />);
    expect(screen.getByRole('button', { name: /Retornar ao Telegram/i })).toBeVisible();
    aguardando.unmount();

    for (const encerrado of [
      { venda_id: 91, status_operacional: 'vendido' },
      { venda_recusada_em: '2026-08-20 10:00:00', status_operacional: 'perdido' },
      { futuro_cliente_excluido_em: '2026-08-20 10:00:00' }
    ]) {
      const tela = render(<FuturoClienteDetalheModal {...props} linha={{ ...base, ...encerrado }} />);
      expect(screen.queryByRole('button', { name: /Retornar ao Telegram/i })).not.toBeInTheDocument();
      tela.unmount();
    }
    localStorage.removeItem('usuario');
  });

  it('permite ao gerente de todos confirmar e reverter uma venda recusada', async () => {
    const linha = {
      id: 41,
      futuro_cliente: 1,
      venda_recusada_em: '2026-08-20 11:39:00',
      venda_recusada_motivo: 'Cliente ja atendido.',
      dados_json: {},
      sondagem: { chips_itens: [] }
    };
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: {
        futuros_clientes_ver_todos: true,
        futuros_clientes_gerenciar_todos: true
      }
    }));
    const onVendaRecusadaRevertida = vi.fn();
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    let concluirReversao;
    const reverter = vi.spyOn(leadPlanilhaService, 'reverterVendaRecusadaFuturoCliente')
      .mockReturnValue(new Promise(resolve => { concluirReversao = resolve; }));
    render(<FuturoClienteDetalheModal
      linha={linha}
      onClose={() => {}}
      onAtualizado={() => {}}
      somenteLeitura
      permitirReverterVendaRecusada
      onVendaRecusadaRevertida={onVendaRecusadaRevertida}
    />);

    const botao = screen.getByRole('button', { name: 'Reverter venda recusada' });
    fireEvent.click(botao);
    expect(reverter).not.toHaveBeenCalled();

    fireEvent.click(botao);
    expect(reverter).toHaveBeenCalledWith(41);
    expect(botao).toBeDisabled();

    concluirReversao({ linha: { ...linha, venda_recusada_em: null, venda_recusada_motivo: null } });
    await waitFor(() => expect(onVendaRecusadaRevertida).toHaveBeenCalledWith(expect.objectContaining({
      id: 41,
      venda_recusada_em: null,
      venda_recusada_motivo: null
    })));

    confirmar.mockRestore();
    reverter.mockRestore();
    localStorage.removeItem('usuario');
  });

  it('restringe a reversao ao gerente de todos na visao Todos', () => {
    const linha = {
      id: 42,
      futuro_cliente: 1,
      venda_recusada_em: '2026-08-20 11:39:00',
      dados_json: {},
      sondagem: { chips_itens: [] }
    };
    const props = {
      linha,
      onClose: () => {},
      onAtualizado: () => {},
      somenteLeitura: true
    };

    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: { futuros_clientes_ver_todos: true }
    }));
    const apenasVisualiza = render(<FuturoClienteDetalheModal {...props} permitirReverterVendaRecusada />);
    expect(screen.queryByRole('button', { name: 'Reverter venda recusada' })).not.toBeInTheDocument();
    apenasVisualiza.unmount();

    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: {
        futuros_clientes_ver_todos: true,
        futuros_clientes_gerenciar_todos: true
      }
    }));
    const visaoMeus = render(<FuturoClienteDetalheModal {...props} />);
    expect(screen.queryByRole('button', { name: 'Reverter venda recusada' })).not.toBeInTheDocument();
    visaoMeus.unmount();

    render(<FuturoClienteDetalheModal
      {...props}
      linha={{ ...linha, venda_recusada_em: null, venda_recusada_motivo: null, status_operacional: 'qualificado' }}
      permitirReverterVendaRecusada
    />);
    expect(screen.queryByRole('button', { name: 'Reverter venda recusada' })).not.toBeInTheDocument();
    localStorage.removeItem('usuario');
  });

  it('mantem o detalhe aberto e exibe o erro quando a reversao falha', async () => {
    localStorage.setItem('usuario', JSON.stringify({
      id: 7,
      permissoes: {
        futuros_clientes_ver_todos: true,
        futuros_clientes_gerenciar_todos: true
      }
    }));
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const reverter = vi.spyOn(leadPlanilhaService, 'reverterVendaRecusadaFuturoCliente')
      .mockRejectedValue(new Error('Nao foi possivel reverter.'));
    render(<FuturoClienteDetalheModal
      linha={{
        id: 43,
        futuro_cliente: 1,
        venda_recusada_em: '2026-08-20 11:39:00',
        dados_json: {},
        sondagem: { chips_itens: [] }
      }}
      onClose={() => {}}
      onAtualizado={() => {}}
      somenteLeitura
      permitirReverterVendaRecusada
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Reverter venda recusada' }));

    expect(await screen.findByText('Nao foi possivel reverter.')).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Detalhes do futuro cliente' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reverter venda recusada' })).toBeEnabled();

    confirmar.mockRestore();
    reverter.mockRestore();
    localStorage.removeItem('usuario');
  });

  it('carrega o historico sob demanda na visao Todos e mantem os dados bloqueados', async () => {
    const buscarHistorico = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente').mockResolvedValue({
      linha_id: 61,
      estado_atual: { rotulo: 'Em atendimento', etapa: 'Negociação', responsavel: { nome: 'Consultora atual' } },
      eventos: [{
        tipo: 'registro', data: '2026-08-01 09:00:00', titulo: 'Futuro cliente registrado',
        usuario: { nome: 'Consultora inicial' }, destinatario: null, motivo: null, detalhe: null
      }, {
        tipo: 'atualizacao', data: '2026-08-01 09:30:00', titulo: 'Dados do futuro cliente atualizados',
        usuario: { nome: 'Consultora atual' }, destinatario: null, motivo: null, detalhe: null
      }]
    });
    render(<FuturoClienteDetalheModal
      linha={{ id: 61, dados_json: {}, envio: { nome: 'Envio' }, estado_atual: { rotulo: 'Na carteira', etapa: 'Qualificação', responsavel: { nome: 'Consultora inicial' } } }}
      onClose={() => {}}
      onAtualizado={() => {}}
      onRegistrarVenda={() => {}}
      somenteLeitura
      exibirHistorico
    />);

    expect(buscarHistorico).not.toHaveBeenCalled();
    expect(screen.getByLabelText('CNPJ')).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }));

    await waitFor(() => expect(buscarHistorico).toHaveBeenCalledWith(61));
    expect(await screen.findByText('Futuro cliente registrado')).toBeVisible();
    expect(screen.getByText('Dados do futuro cliente atualizados')).toBeVisible();
    expect(screen.getByText('Por: Consultora inicial')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Atualizar dados do futuro cliente' })).not.toBeInTheDocument();
    expect(screen.getByText('Consultora atual')).toBeVisible();
    buscarHistorico.mockRestore();
  });

  it('permite tentar novamente quando o historico falha', async () => {
    const buscarHistorico = vi.spyOn(leadPlanilhaService, 'obterHistoricoFuturoCliente')
      .mockRejectedValueOnce(new Error('Falha temporária'))
      .mockResolvedValueOnce({ linha_id: 62, estado_atual: null, eventos: [] });
    render(<FuturoClienteDetalheModal
      linha={{ id: 62, dados_json: {}, envio: { nome: 'Envio' }, estado_atual: { rotulo: 'Na carteira' } }}
      onClose={() => {}}
      onAtualizado={() => {}}
      onRegistrarVenda={() => {}}
      somenteLeitura
      exibirHistorico
    />);

    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }));
    expect(await screen.findByText('Falha temporária')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nenhum evento comercial encontrado.')).toBeVisible();
    expect(buscarHistorico).toHaveBeenCalledTimes(2);
    buscarHistorico.mockRestore();
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

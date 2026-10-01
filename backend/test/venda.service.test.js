const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const vendaService = require('../src/services/venda.service');
const Usuario = require('../src/models/Usuario');

const {
  adicionarMesesDataISO,
  aplicarDadosClienteNaVenda,
  aplicarEstiloExportacao,
  filtrarVendasRelatorioPorVendedora,
  montarDadosSincronizacaoClienteVenda,
  montarColunasXlsxVendas,
  montarDetalhesChipsExportacao,
  montarLinhaXlsxVenda,
  observacaoUltimaMovimentacaoExportacao,
  statusVendaExportacao,
  montarAtribuicoesVendedorasVenda,
  montarAlteracoesReversao,
  validarBloqueioEdicaoPosVenda,
  anexarReversoesVenda,
  aplicarFiltrosDataEfetivaVenda,
  aplicarOrdenacaoDataEfetivaVenda,
  montarExpressaoDataEfetivaVenda,
  montarExpressaoUltimaReversaoVenda,
  validarMotivoExclusaoReversao,
  montarPayload,
  normalizarData,
  resolverDataVendaCadastro,
  resolverDataVendaAtualizacao,
  validarPermissaoAlterarDataVenda,
  validarDataVendaAntiga,
  validarDataVendaNaoFutura,
  normalizarItensChips,
  vendaDeveNotificarTelegram,
  montarEscopoVendasUsuario,
  usuarioPodeAcessarVenda,
  obterDataLimiteConcluidaAntiga,
  obterTipoLinhaPorNomeTipoVenda,
  obterQuantidadeChipsVenda,
  obterUltimaAtividadeFunil,
  parseValorMonetario,
  atribuirLeadOrigemAoUsuario,
  buscarLeadOrigemExplicita,
  garantirAtribuicaoVendaLeadOrigem,
  leadOrigemExplicitaElegivel,
  resolverLeadOrigemCadastro,
  usuarioPossuiMailingDaLinha,
  validarVendedorasNosChips,
  vendaDeveAparecerNoFunil,
  obterConclusaoEfetivaHistorico,
  prepararEdicaoConclusao
} = vendaService._internals;

test('edicao da conclusao preserva a data anterior e identifica o ultimo editor no historico', () => {
  const historico = [
    {
      id: 1,
      acao: 'venda.status_atualizado',
      status_anterior: 'entrega',
      status_novo: 'concluido',
      created_at: '2026-09-10 12:00:00'
    },
    {
      id: 2,
      acao: 'venda.conclusao_editada',
      status_anterior: 'concluido',
      status_novo: 'concluido',
      dados: JSON.stringify({ concluida_em: '2026-09-11 14:00:00' }),
      created_at: '2026-09-12 09:00:00'
    }
  ];

  const resultado = prepararEdicaoConclusao({
    venda: {
      id: 7,
      status_funil: 'concluido',
      enviada_pos_venda_em: '2026-09-01 10:00:00',
      excluido_em: null,
      cancelada_em: null
    },
    historico,
    concluidaEm: '2026-09-09T15:30:00.000Z',
    usuarioId: 22,
    etapaFinal: 'concluido',
    agora: new Date('2026-09-13T10:00:00.000Z')
  });

  assert.equal(obterConclusaoEfetivaHistorico(historico, 'concluido'), '2026-09-11 14:00:00');
  assert.equal(resultado.status, 'ok');
  assert.equal(resultado.historico.acao, 'venda.conclusao_editada');
  assert.equal(resultado.historico.usuarioId, 22);
  assert.equal(resultado.historico.statusNovo, null);
  assert.equal(resultado.historico.dados.status_funil, 'concluido');
  assert.equal(resultado.historico.dados.concluida_em_anterior, '2026-09-11 14:00:00');
  assert.equal(resultado.historico.dados.concluida_em, '2026-09-09 15:30:00');
  assert.equal(resultado.historico.createdAt, '2026-09-13 10:00:00');
});

test('edicao da conclusao rejeita estado ou intervalo impossivel e alteracao redundante', () => {
  const base = {
    venda: {
      id: 7,
      status_funil: 'entrega',
      enviada_pos_venda_em: '2026-09-10 08:00:00',
      excluido_em: null,
      cancelada_em: null
    },
    historico: [{
      id: 1,
      acao: 'venda.status_atualizado',
      status_anterior: 'entrega',
      status_novo: 'concluido',
      created_at: '2026-09-12 09:00:00'
    }],
    concluidaEm: '2026-09-13T09:00:00.000Z',
    usuarioId: 22,
    etapaFinal: 'concluido',
    agora: new Date('2026-09-13T10:00:00.000Z')
  };

  assert.equal(prepararEdicaoConclusao(base).status, 'invalid');
  assert.match(prepararEdicaoConclusao({
    ...base,
    venda: { ...base.venda, status_funil: 'concluido' },
    concluidaEm: '2026-09-13T11:00:00.000Z'
  }).message, /futura/i);
  assert.match(prepararEdicaoConclusao({
    ...base,
    venda: { ...base.venda, status_funil: 'concluido' },
    concluidaEm: '2026-09-09T11:00:00.000Z'
  }).message, /anterior ao envio/i);
  assert.match(prepararEdicaoConclusao({
    ...base,
    venda: { ...base.venda, status_funil: 'concluido', enviada_pos_venda_em: null }
  }).message, /não possui data de envio/i);
  assert.match(prepararEdicaoConclusao({
    ...base,
    venda: { ...base.venda, status_funil: 'concluido' },
    concluidaEm: '2026-09-12T09:00:30.000Z'
  }).message, /data diferente/i);
});

test('admin acessa todas as vendas sem limite mesmo com negacoes locais', () => {
  const escopo = montarEscopoVendasUsuario({
    ativo: true,
    role: { nome: 'admin' },
    permissoes: {
      vendas_ver_todas: false,
      vendas_ver_proprias: false,
      ver_vendas_compartilhadas: false,
      vendas_limitar_ultimos_6_meses: true
    }
  });

  assert.deepEqual(escopo, {
    podeVerTodas: true,
    podeVerProprias: true,
    podeVerCompartilhadas: true,
    limitarUltimos6Meses: false
  });
});

test('usuario comum preserva o escopo configurado de vendas', () => {
  const escopo = montarEscopoVendasUsuario({
    ativo: true,
    role: {
      nome: 'usuario',
      permissoes: { vendas_ver_proprias: true }
    },
    permissoes: { vendas_limitar_ultimos_6_meses: true }
  });

  assert.deepEqual(escopo, {
    podeVerTodas: false,
    podeVerProprias: true,
    podeVerCompartilhadas: false,
    limitarUltimos6Meses: true
  });
});

test('admin acessa venda de outro usuario sem consultar posse ou vinculo', async () => {
  const queryOriginal = Usuario.query;
  Usuario.query = () => ({
    findById() {
      return this;
    },
    withGraphFetched() {
      return Promise.resolve({
        id: 7,
        ativo: true,
        role: { nome: 'admin' },
        permissoes: {
          vendas_ver_todas: false,
          vendas_ver_proprias: false,
          ver_vendas_compartilhadas: false
        }
      });
    }
  });

  try {
    assert.equal(await usuarioPodeAcessarVenda(999, 7), true);
  } finally {
    Usuario.query = queryOriginal;
  }
});

test('mantem lead que ja pertence ao usuario e garante sua atribuicao de venda', async () => {
  let verificouMailing = false;
  let atribuiu = false;
  let garantiuAtribuicaoVenda = false;
  const linha = { id: 15, futuro_cliente: true, atribuido_para_id: 7 };

  const resultado = await buscarLeadOrigemExplicita({
    origemLeadLinhaId: 15,
    usuarioId: 7,
    trx: {},
    buscarLinha: async () => linha,
    verificarPosseMailing: async () => {
      verificouMailing = true;
      return true;
    },
    atribuirAoUsuario: async () => {
      atribuiu = true;
      return linha;
    },
    garantirAtribuicaoVenda: async parametros => {
      garantiuAtribuicaoVenda = true;
      assert.equal(parametros.linha, linha);
      assert.equal(parametros.usuarioId, 7);
    }
  });

  assert.equal(resultado, linha);
  assert.equal(verificouMailing, false);
  assert.equal(atribuiu, false);
  assert.equal(garantiuAtribuicaoVenda, true);
});

test('usuario que possui o mailing assume futuro cliente sem responsavel', async () => {
  const linha = { id: 15, envio_id: 81, futuro_cliente: true, atribuido_para_id: null };
  let parametrosAtribuicao = null;

  const resultado = await buscarLeadOrigemExplicita({
    origemLeadLinhaId: 15,
    usuarioId: 7,
    trx: { nome: 'transacao' },
    buscarLinha: async () => linha,
    verificarPosseMailing: async parametros => {
      assert.equal(parametros.linha, linha);
      assert.equal(parametros.usuarioId, 7);
      return true;
    },
    atribuirAoUsuario: async parametros => {
      parametrosAtribuicao = parametros;
      return { ...linha, atribuido_para_id: parametros.usuarioId };
    }
  });

  assert.equal(resultado.atribuido_para_id, 7);
  assert.equal(parametrosAtribuicao.linha, linha);
  assert.equal(parametrosAtribuicao.usuarioId, 7);
  assert.deepEqual(parametrosAtribuicao.trx, { nome: 'transacao' });
});

test('nao permite assumir futuro cliente sem possuir o mailing', async () => {
  let atribuiu = false;
  const resultado = await buscarLeadOrigemExplicita({
    origemLeadLinhaId: 15,
    usuarioId: 7,
    trx: {},
    buscarLinha: async () => ({ id: 15, envio_id: 81, futuro_cliente: true, atribuido_para_id: null }),
    verificarPosseMailing: async () => false,
    atribuirAoUsuario: async () => {
      atribuiu = true;
      return {};
    }
  });

  assert.equal(resultado, null);
  assert.equal(atribuiu, false);
});

test('nao permite assumir futuro cliente atribuido a outro usuario', async () => {
  const resultado = await buscarLeadOrigemExplicita({
    origemLeadLinhaId: 15,
    usuarioId: 7,
    trx: {},
    buscarLinha: async () => ({ id: 15, futuro_cliente: true, atribuido_para_id: 9 }),
    verificarPosseMailing: async () => assert.fail('nao deve consultar o mailing')
  });

  assert.equal(resultado, null);
});

test('aceita lead comum do mailing e rejeita origem explicita excluida ou vendida', () => {
  assert.equal(leadOrigemExplicitaElegivel(null), false);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: false }), true);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: '0' }), true);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: true, futuro_cliente_excluido_em: '2026-08-24 10:00:00' }), false);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: true, venda_id: 91 }), false);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: true, status_operacional: 'vendido' }), false);
  assert.equal(leadOrigemExplicitaElegivel({ futuro_cliente: true, atribuido_para_id: null }), true);
});

test('valida posse somente em mailing ativo associado ao usuario', async () => {
  const consulta = { joins: [], filtros: null, nulos: [], campo: null };
  const query = {
    join(...args) {
      consulta.joins.push(args);
      return this;
    },
    where(filtros) {
      consulta.filtros = filtros;
      return this;
    },
    whereNull(campo) {
      consulta.nulos.push(campo);
      return this;
    },
    first(campo) {
      consulta.campo = campo;
      return { id: 91 };
    }
  };

  const possui = await usuarioPossuiMailingDaLinha({
    linha: { envio_id: 81 },
    usuarioId: 7,
    trx: tabela => {
      assert.equal(tabela, 'lead_envio_usuarios as leu');
      return query;
    }
  });

  assert.equal(possui, true);
  assert.deepEqual(consulta.joins, [['lead_envios as le', 'le.id', 'leu.envio_id']]);
  assert.deepEqual(consulta.filtros, {
    'leu.envio_id': 81,
    'leu.usuario_id': 7,
    'le.origem': 'mailing'
  });
  assert.deepEqual(consulta.nulos, ['le.cancelado_em']);
  assert.equal(consulta.campo, 'leu.id');
});

test('atribui a linha e registra historico da etapa de venda', async () => {
  const gravacoes = [];
  const trx = tabela => {
    if (tabela === 'lead_linhas') {
      return {
        where(filtros) {
          gravacoes.push({ tabela, operacao: 'where', dados: filtros });
          return this;
        },
        update(patch) {
          gravacoes.push({ tabela, operacao: 'update', dados: patch });
          return 1;
        }
      };
    }
    assert.equal(tabela, 'lead_atribuicoes');
    return {
      insert(dados) {
        gravacoes.push({ tabela, operacao: 'insert', dados });
        return [101];
      }
    };
  };

  const resultado = await atribuirLeadOrigemAoUsuario({
    linha: { id: 15, envio_id: 81, atribuido_para_id: null },
    usuarioId: 7,
    trx,
    garantirAtribuicaoVenda: async ({ linha, usuarioId }) => {
      gravacoes.push({
        tabela: 'lead_atribuicoes',
        operacao: 'insert',
        dados: {
          lead_linha_id: linha.id,
          envio_id: linha.envio_id,
          usuario_id: usuarioId,
          etapa: 'venda',
          status: 'atribuido',
          criado_por_id: usuarioId
        }
      });
    }
  });

  assert.equal(resultado.atribuido_para_id, 7);
  assert.deepEqual(gravacoes[0].dados, { id: 15, atribuido_para_id: null });
  assert.equal(gravacoes[1].dados.atribuido_para_id, 7);
  assert.ok(gravacoes[1].dados.updated_at instanceof Date);
  assert.deepEqual(gravacoes[2], {
    tabela: 'lead_atribuicoes',
    operacao: 'insert',
    dados: {
      lead_linha_id: 15,
      envio_id: 81,
      usuario_id: 7,
      etapa: 'venda',
      status: 'atribuido',
      criado_por_id: 7
    }
  });
});

test('reutiliza atribuicao de venda ativa e cria somente quando ela nao existe', async () => {
  let insercoes = 0;
  function criarTrx(existente) {
    return tabela => {
      assert.equal(tabela, 'lead_atribuicoes');
      return {
        where() { return this; },
        whereNull() { return this; },
        orderBy() { return this; },
        first() { return existente ? { id: 91 } : null; },
        insert() { insercoes += 1; return [101]; }
      };
    };
  }

  const parametros = { linha: { id: 15, envio_id: 81 }, usuarioId: 7 };
  const existente = await garantirAtribuicaoVendaLeadOrigem({ ...parametros, trx: criarTrx(true) });
  await garantirAtribuicaoVendaLeadOrigem({ ...parametros, trx: criarTrx(false) });

  assert.deepEqual(existente, { id: 91 });
  assert.equal(insercoes, 1);
});

test('nao registra atribuicao se outra transacao assumir a linha primeiro', async () => {
  let inseriu = false;
  const resultado = await atribuirLeadOrigemAoUsuario({
    linha: { id: 15, envio_id: 81, atribuido_para_id: null },
    usuarioId: 7,
    trx: tabela => {
      if (tabela === 'lead_linhas') {
        return {
          where() { return this; },
          update() { return 0; }
        };
      }
      inseriu = true;
      return { insert() { return [101]; } };
    }
  });

  assert.equal(resultado, null);
  assert.equal(inseriu, false);
});

test('origem explicita tem prioridade e impede a busca automatica', async () => {
  const explicita = { id: 15 };
  let buscasAutomaticas = 0;
  const resultado = await resolverLeadOrigemCadastro({
    origemLeadLinhaId: 15,
    usuarioId: 7,
    cnpj: '12.345.678/0001-90',
    vendedorasIds: [7],
    criadoEm: '2026-08-18 12:00:00',
    trx: {},
    buscarExplicita: async () => explicita,
    buscarAutomatica: async () => {
      buscasAutomaticas += 1;
      return { id: 99 };
    }
  });

  assert.deepEqual(resultado, { linha: explicita, tipo: 'explicita' });
  assert.equal(buscasAutomaticas, 0);
});

test('sem origem explicita usa apenas a resolucao prospectiva por CNPJ', async () => {
  const automatica = { id: 22 };
  const resultado = await resolverLeadOrigemCadastro({
    origemLeadLinhaId: null,
    usuarioId: 3,
    cnpj: '12.345.678/0001-90',
    vendedorasIds: [7, 9],
    criadoEm: '2026-08-18 12:00:00',
    trx: {},
    buscarExplicita: async () => assert.fail('nao deve buscar origem explicita'),
    buscarAutomatica: async parametros => {
      assert.deepEqual(parametros.vendedorasIds, [7, 9]);
      return automatica;
    }
  });

  assert.deepEqual(resultado, { linha: automatica, tipo: 'automatica_cnpj' });
});

test('monta data efetiva com a ultima reversao ativa no fuso de Sao Paulo', () => {
  const expressao = montarExpressaoDataEfetivaVenda('vendas');
  const ultimaReversao = montarExpressaoUltimaReversaoVenda('vendas');

  assert.match(ultimaReversao, /MAX\(vh_data_efetiva\.created_at\)/);
  assert.match(ultimaReversao, /vh_data_efetiva\.acao = 'venda\.reversao_registrada'/);
  assert.match(ultimaReversao, /vh_data_efetiva\.deleted_at IS NULL/);
  assert.match(expressao, /America\/Sao_Paulo/);
  assert.match(expressao, /vendas\.data_venda/);
});

test('aplica limites inclusivos e limite de escopo sobre a mesma data efetiva', () => {
  const chamadas = [];
  const query = {
    whereRaw(sql, bindings) {
      chamadas.push({ sql, bindings });
      return this;
    }
  };

  const expressao = aplicarFiltrosDataEfetivaVenda(query, {
    data_inicio: '2026-08-01',
    data_fim: '2026-08-31'
  }, '2026-02-14');

  assert.equal(chamadas.length, 3);
  assert.deepEqual(chamadas.map(item => item.bindings), [
    ['2026-08-01'],
    ['2026-08-31'],
    ['2026-02-14']
  ]);
  assert.equal(chamadas[0].sql, `${expressao} >= ?`);
  assert.equal(chamadas[1].sql, `${expressao} <= ?`);
  assert.equal(chamadas[2].sql, `${expressao} >= ?`);
});

test('aceita filtros de data efetiva com apenas um dos limites', () => {
  const chamadasInicio = [];
  const chamadasFim = [];
  const criarQuery = chamadas => ({
    whereRaw(sql, bindings) {
      chamadas.push({ sql, bindings });
      return this;
    }
  });

  aplicarFiltrosDataEfetivaVenda(criarQuery(chamadasInicio), { data_inicio: '2026-08-01' });
  aplicarFiltrosDataEfetivaVenda(criarQuery(chamadasFim), { data_fim: '2026-08-31' });

  assert.deepEqual(chamadasInicio.map(item => item.bindings), [['2026-08-01']]);
  assert.deepEqual(chamadasFim.map(item => item.bindings), [['2026-08-31']]);
  assert.match(chamadasInicio[0].sql, />= \?$/);
  assert.match(chamadasFim[0].sql, /<= \?$/);
});

test('ordena sempre pela data efetiva e usa o id como desempate', () => {
  const chamadas = [];
  const query = {
    orderByRaw(sql) {
      chamadas.push(['raw', sql]);
      return this;
    },
    orderBy(coluna, direcao) {
      chamadas.push(['column', coluna, direcao]);
      return this;
    }
  };

  aplicarOrdenacaoDataEfetivaVenda(query, 'data_efetiva_teste');

  assert.deepEqual(chamadas, [
    ['raw', 'data_efetiva_teste DESC'],
    ['column', 'vendas.id', 'desc']
  ]);
});

test('normaliza datas validas e rejeita datas invalidas', () => {
  assert.equal(normalizarData('2026-05-18'), '2026-05-18');
  assert.equal(normalizarData('18/05/2026'), '2026-05-18');
  assert.equal(normalizarData('18/05/26'), '2026-05-18');
  assert.equal(normalizarData('2026-02-31'), null);
  assert.equal(normalizarData('1899-12-31'), null);
});

test('impede data de venda futura considerando o fuso de Sao Paulo', () => {
  const agora = new Date('2026-08-05T02:00:00.000Z');

  assert.doesNotThrow(() => validarDataVendaNaoFutura('2026-08-04', agora));
  assert.doesNotThrow(() => validarDataVendaNaoFutura('2026-08-03', agora));
  assert.throws(() => validarDataVendaNaoFutura('2026-08-05', agora), /não pode ser futura/i);
});

test('monta alteracoes de reversao normalizando campos simples e compostos', () => {
  const alteracoes = montarAlteracoesReversao({
    nome: 'Cliente antigo',
    cliente_da_base: 0,
    valores_unitarios_chips: JSON.stringify([{ quantidade: 1, valor_unitario: 30 }])
  }, {
    nome: 'Cliente novo',
    cliente_da_base: true,
    valores_unitarios_chips: [{ valor_unitario: 30, quantidade: 1 }],
    valor_total: 30
  }, [2], [2, 3]);

  assert.deepEqual(alteracoes, [
    { campo: 'nome', anterior: 'Cliente antigo', novo: 'Cliente novo' },
    { campo: 'cliente_da_base', anterior: false, novo: true },
    { campo: 'vendedoras', anterior: [2], novo: [2, 3] }
  ]);
});

test('preserva o bypass interno de reversao para usuarios nao sujeitos ao resumo protegido', () => {
  assert.doesNotThrow(() => validarBloqueioEdicaoPosVenda({
    enviada_pos_venda_em: '2026-08-13 11:00:00'
  }, false, true));
});

test('mantem bloqueada a edicao comum de venda enviada para usuario sem permissao de pos-venda', () => {
  assert.throws(
    () => validarBloqueioEdicaoPosVenda({ enviada_pos_venda_em: '2026-08-13 11:00:00' }, false, false),
    error => error.statusCode === 403 && /Apenas usuários com permissão de pós-venda/i.test(error.message)
  );
});

test('anexa reversoes cronologicas e campos marcados ao retorno da venda', () => {
  const venda = anexarReversoesVenda({
    historico: [
      {
        id: 12,
        acao: 'venda.reversao_registrada',
        observacao: 'Segunda',
        created_at: '2026-08-13T12:00:00.000Z',
        dados: JSON.stringify({ numero: 2, alteracoes: [{ campo: 'telefone', anterior: '1', novo: '2' }] })
      },
      {
        id: 11,
        acao: 'venda.reversao_registrada',
        observacao: 'Primeira',
        created_at: '2026-08-13T11:00:00.000Z',
        dados: { numero: 1, alteracoes: [{ campo: 'nome', anterior: 'A', novo: 'B' }] }
      }
    ]
  });

  assert.deepEqual(venda.reversoes.map(item => item.numero), [1, 2]);
  assert.deepEqual(venda.campos_com_reversao, ['nome', 'telefone']);
});

test('oculta reversoes excluidas da venda e dos campos marcados', () => {
  const venda = anexarReversoesVenda({
    historico: [
      {
        id: 11,
        acao: 'venda.reversao_registrada',
        observacao: 'Ativa',
        created_at: '2026-08-13T11:00:00.000Z',
        dados: { numero: 1, alteracoes: [{ campo: 'nome', anterior: 'A', novo: 'B' }] }
      },
      {
        id: 12,
        acao: 'venda.reversao_registrada',
        observacao: 'Ocultada',
        created_at: '2026-08-13T12:00:00.000Z',
        deleted_at: '2026-08-14T10:00:00.000Z',
        dados: { numero: 2, alteracoes: [{ campo: 'telefone', anterior: '1', novo: '2' }] }
      }
    ]
  });

  assert.deepEqual(venda.reversoes.map(item => item.numero), [1]);
  assert.deepEqual(venda.campos_com_reversao, ['nome']);
});

test('valida e normaliza o motivo para excluir reversao', () => {
  assert.equal(validarMotivoExclusaoReversao('  Registro duplicado  '), 'Registro duplicado');
  assert.throws(() => validarMotivoExclusaoReversao('  '), /informe o motivo/i);
  assert.throws(() => validarMotivoExclusaoReversao('x'.repeat(1001)), /máximo 1000/i);
});

test('define no servidor a data de uma venda comum no fuso de Sao Paulo', () => {
  const antesDaViradaEmSaoPaulo = new Date('2026-08-05T02:30:00.000Z');
  const depoisDaViradaEmSaoPaulo = new Date('2026-08-05T03:30:00.000Z');

  assert.deepEqual(
    resolverDataVendaCadastro({ data_venda: '2020-01-01' }, antesDaViradaEmSaoPaulo),
    { venda_antiga: false, data_venda: '2026-08-04' }
  );
  assert.deepEqual(
    resolverDataVendaCadastro({ venda_antiga: false, data_venda: '2020-01-01' }, depoisDaViradaEmSaoPaulo),
    { venda_antiga: false, data_venda: '2026-08-05' }
  );
});

test('exige data anterior ao dia atual para venda antiga', () => {
  const agora = new Date('2026-08-05T15:00:00.000Z');

  assert.equal(validarDataVendaAntiga('2026-08-04', agora), '2026-08-04');
  assert.deepEqual(
    resolverDataVendaCadastro({ venda_antiga: true, data_venda: '04/08/2026' }, agora),
    { venda_antiga: true, data_venda: '2026-08-04' }
  );
  assert.throws(() => validarDataVendaAntiga(null, agora), /informe a data/i);
  assert.throws(() => validarDataVendaAntiga('2026-08-05', agora), /anterior ao dia atual/i);
  assert.throws(() => validarDataVendaAntiga('2026-08-06', agora), /anterior ao dia atual/i);
});

test('resolve alteracao da data de venda sem limite temporal', () => {
  const vendaAtual = { venda_antiga: false, data_venda: '2026-08-04' };

  assert.deepEqual(
    resolverDataVendaAtualizacao({ venda_antiga: false, data_venda: '2026-08-05' }, vendaAtual),
    {
      aplicarClassificacao: true,
      aplicarData: true,
      vendaAntigaDesejada: false,
      dataVendaDesejada: '2026-08-05',
      alterou: true
    }
  );
  assert.equal(
    resolverDataVendaAtualizacao({ data_venda: '2035-12-31' }, vendaAtual).dataVendaDesejada,
    '2035-12-31'
  );
});

test('preserva data comum omitida ou nula e rejeita data invalida na edicao', () => {
  const vendaAtual = { venda_antiga: false, data_venda: '2026-08-04' };

  assert.equal(resolverDataVendaAtualizacao({}, vendaAtual).aplicarData, false);
  assert.deepEqual(
    resolverDataVendaAtualizacao({ venda_antiga: false, data_venda: null }, vendaAtual),
    {
      aplicarClassificacao: true,
      aplicarData: false,
      vendaAntigaDesejada: false,
      dataVendaDesejada: '2026-08-04',
      alterou: false
    }
  );
  assert.throws(
    () => resolverDataVendaAtualizacao({ data_venda: '2026-02-30' }, vendaAtual),
    error => error.statusCode === 400 && /data da venda válida/i.test(error.message)
  );
  assert.throws(
    () => resolverDataVendaAtualizacao({ data_venda: '' }, vendaAtual),
    /data da venda válida/i
  );
});

test('exige a permissao dedicada quando data ou classificacao muda', () => {
  assert.doesNotThrow(() => validarPermissaoAlterarDataVenda(false, false));
  assert.doesNotThrow(() => validarPermissaoAlterarDataVenda(true, true));
  assert.throws(
    () => validarPermissaoAlterarDataVenda(true, false),
    error => error.statusCode === 403 && /permissão para alterar a data/i.test(error.message)
  );
});

test('notifica Telegram apenas para vendas com no maximo dois dias de atraso', () => {
  const agora = new Date('2026-08-05T15:00:00.000Z');

  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-05' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-03' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-02' }, agora), false);
  assert.equal(vendaDeveNotificarTelegram({ data_venda: '2026-08-10' }, agora), true);
  assert.equal(vendaDeveNotificarTelegram({}, agora), true);
});

test('converte valores monetarios brasileiros e numericos', () => {
  assert.equal(parseValorMonetario('R$ 1.234,56'), 1234.56);
  assert.equal(parseValorMonetario('99,90'), 99.9);
  assert.equal(parseValorMonetario(120.5), 120.5);
  assert.equal(parseValorMonetario(''), 0);
});

test('normaliza chips de array, JSON e texto legado', () => {
  assert.deepEqual(normalizarItensChips([
    { quantidade: '2', gb: '25GB', tipo_linha: 'Portabilidade', valor_unitario: '59,90', operadora_atual_id: '3', operadora_atual_nome: 'TIM', operadora_id: '5', operadora_nome: 'Claro', vendedora_id: '7' },
    { quantidade: 0, gb: '10', valor_unitario: 20 }
  ]), [
    { quantidade: 2, gb: '25', tipo_linha: 'portabilidade', valor_unitario: 59.9, operadora_atual_id: 3, operadora_atual_nome: 'TIM', operadora_id: 5, operadora_nome: 'Claro', vendedora_id: 7 }
  ]);

  assert.deepEqual(normalizarItensChips(JSON.stringify([
    { quantidade: 1, gb: '15', tipo: 'Novo', valor_unitario: 45 }
  ])), [
    { quantidade: 1, gb: '15', tipo_linha: 'novo', valor_unitario: 45 }
  ]);

  assert.deepEqual(normalizarItensChips('2x49,90\n1 x 39.90'), [
    { quantidade: 2, gb: '', tipo_linha: 'novo', valor_unitario: 49.9 },
    { quantidade: 1, gb: '', tipo_linha: 'novo', valor_unitario: 39.9 }
  ]);
});

test('exporta o nome configurado da etapa mesmo quando o codigo diverge do nome', () => {
  const mapaEtapas = new Map([
    ['envio', 'Aceite/Biometria'],
    ['concluido', 'Concluído']
  ]);

  assert.equal(statusVendaExportacao({ status_funil: 'envio' }, mapaEtapas), 'Aceite/Biometria');
  assert.equal(statusVendaExportacao({ status_funil: 'concluido' }, mapaEtapas), 'Concluído');
});

test('exporta rotulo de retorno e mantem o codigo quando a etapa nao existe mais', () => {
  const mapaEtapas = new Map([['envio', 'Aceite/Biometria']]);

  assert.equal(statusVendaExportacao({ status_funil: 'retorno' }, mapaEtapas), 'Retorno');
  assert.equal(statusVendaExportacao({ status_funil: 'etapa_removida' }, mapaEtapas), 'etapa_removida');
});

test('avisa que falta enviar ao pos-venda em vez de exportar status vazio', () => {
  const mapaEtapas = new Map([['envio', 'Aceite/Biometria']]);

  // status_funil e nulo ate a venda ser enviada ao pos-venda
  assert.equal(statusVendaExportacao({ status_funil: null }, mapaEtapas), 'Falta enviar ao pós-venda');
  assert.equal(statusVendaExportacao({ status_funil: '' }, mapaEtapas), 'Falta enviar ao pós-venda');
  assert.equal(
    statusVendaExportacao({ status_funil: null, enviada_pos_venda_em: '2026-09-01' }, mapaEtapas),
    'Sem etapa'
  );
  assert.equal(statusVendaExportacao({ status_funil: null, cancelada_em: '2026-08-01' }, mapaEtapas), 'Cancelada');
});

test('indica cancelamento sem esconder a etapa da venda na exportacao', () => {
  const mapaEtapas = new Map([['envio', 'Aceite/Biometria']]);

  assert.equal(
    statusVendaExportacao({ status_funil: 'envio', cancelada_em: '2026-08-01' }, mapaEtapas),
    'Aceite/Biometria (Cancelada)'
  );
  assert.equal(statusVendaExportacao({ status_funil: '', cancelada_em: '2026-08-01' }, mapaEtapas), 'Cancelada');
});

test('exporta a observacao da ultima movimentacao valida para o status atual', () => {
  const venda = {
    status_funil: 'entrega',
    historico: [
      { id: 1, status_anterior: 'analise', status_novo: 'entrega', observacao: 'Primeira entrada', created_at: '2026-08-01 10:00:00' },
      { id: 2, status_anterior: 'entrega', status_novo: 'entrega', observacao: 'Apenas uma anotacao', created_at: '2026-08-02 10:00:00' },
      { id: 3, status_anterior: 'aceite', status_novo: 'entrega', observacao: 'Movimentacao invalidada', invalidated_at: '2026-08-03 11:00:00', created_at: '2026-08-03 10:00:00' },
      { id: 4, status_anterior: 'envio', status_novo: 'entrega', observacao: 'Movimentacao excluida', deleted_at: '2026-08-04 11:00:00', created_at: '2026-08-04 10:00:00' },
      { id: 5, status_anterior: 'confirmacao', status_novo: 'concluido', observacao: 'Outro status', created_at: '2026-08-05 10:00:00' },
      { id: 6, status_anterior: 'envio', status_novo: 'entrega', observacao: '  Ultima entrada valida  ', created_at: '2026-08-06 10:00:00' }
    ]
  };

  assert.equal(observacaoUltimaMovimentacaoExportacao(venda), 'Ultima entrada valida');
});

test('diferencia os status e posiciona a observacao depois deles na planilha de vendas', () => {
  const colunas = montarColunasXlsxVendas();
  const indiceStatus = colunas.findIndex(coluna => coluna.key === 'status_interno');

  assert.equal(colunas[indiceStatus].header, 'STATUS INTERNO');
  assert.equal(colunas[indiceStatus + 1].key, 'status_automacao');
  assert.equal(colunas[indiceStatus + 1].header, 'STATUS AUTOMAÇÃO');
  assert.equal(colunas[indiceStatus + 2].key, 'observacao_movimentacao');
  assert.equal(colunas[indiceStatus + 2].header, 'OBSERVAÇÃO');
  assert.equal(colunas[indiceStatus + 3].key, 'prioridade');
});

test('exporta separadamente as etapas e os cancelamentos dos funis interno e automatico', () => {
  const mapaEtapas = new Map([
    ['aceite', 'Aceite/Biometria'],
    ['entrega', 'Entrega']
  ]);
  const linha = montarLinhaXlsxVenda(
    { status_funil: 'aceite', cancelada_em: null, enviada_pos_venda_em: '2026-09-01' },
    { vendedora: 'Ana', quantidadeChips: 1, valoresUnitarios: 'R$ 20,00' },
    false,
    'concluido',
    mapaEtapas,
    { status_funil: 'entrega', cancelada_em: '2026-09-10' }
  );

  assert.equal(linha.status_interno, 'Aceite/Biometria');
  assert.equal(linha.status_automacao, 'Entrega (Cancelada)');
});

test('nao copia o status interno quando o funil automatico ainda nao possui estado', () => {
  const mapaEtapas = new Map([['aceite', 'Aceite/Biometria']]);
  const detalhes = { vendedora: 'Ana', quantidadeChips: 1, valoresUnitarios: 'R$ 20,00' };

  const antesDoEnvio = montarLinhaXlsxVenda(
    { status_funil: 'aceite', enviada_pos_venda_em: null },
    detalhes,
    false,
    'concluido',
    mapaEtapas
  );
  const depoisDoEnvio = montarLinhaXlsxVenda(
    { status_funil: 'aceite', enviada_pos_venda_em: '2026-09-01' },
    detalhes,
    false,
    'concluido',
    mapaEtapas
  );

  assert.equal(antesDoEnvio.status_interno, 'Aceite/Biometria');
  assert.equal(antesDoEnvio.status_automacao, 'Falta enviar ao pós-venda');
  assert.equal(depoisDoEnvio.status_automacao, 'Sem etapa');
});

test('resume separadamente os dois status quando a venda tem visualizacao restrita', () => {
  const detalhes = { vendedora: 'Ana', quantidadeChips: 1, valoresUnitarios: 'R$ 20,00' };
  const linha = montarLinhaXlsxVenda(
    { status_funil: 'aceite', enviada_pos_venda_em: '2026-09-01' },
    detalhes,
    true,
    'concluido',
    new Map(),
    { status_funil: 'concluido' }
  );

  assert.equal(linha.status_interno, 'Não concluída');
  assert.equal(linha.status_automacao, 'Concluída');
});

test('posiciona classificacao do cliente depois do documento na planilha de vendas', () => {
  const colunas = montarColunasXlsxVendas();
  const indiceDocumento = colunas.findIndex(coluna => coluna.key === 'cnpj');

  assert.equal(colunas[indiceDocumento + 1].key, 'classificacao_cliente');
  assert.equal(colunas[indiceDocumento + 1].header, 'CLASSIFICAÇÃO DO CLIENTE');
  assert.equal(colunas[indiceDocumento + 2].key, 'vendedora');
});

test('posiciona quantidade de chips imediatamente antes de linhas na planilha de vendas', () => {
  const colunas = montarColunasXlsxVendas();
  const indiceLinhas = colunas.findIndex(coluna => coluna.key === 'quantidade_linhas');

  assert.equal(colunas[indiceLinhas - 1].key, 'quantidade_chips_vendedora');
  assert.equal(colunas[indiceLinhas - 1].header, 'QUANTIDADE DE CHIPS');
  assert.equal(colunas[indiceLinhas].header, 'LINHAS');
});

test('centraliza cabecalhos e valores da planilha de vendas', () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Vendas');
  worksheet.columns = [
    { header: 'CLIENTE', key: 'cliente' },
    { header: 'VALOR', key: 'valor' }
  ];
  worksheet.addRow({ cliente: 'Empresa Teste', valor: 100 });

  aplicarEstiloExportacao(worksheet);

  worksheet.eachRow(row => {
    row.eachCell(cell => {
      assert.equal(cell.alignment.horizontal, 'center');
      assert.equal(cell.alignment.vertical, 'middle');
    });
  });
});

test('exporta classificacao do cliente na linha principal de vendas', () => {
  const detalhes = { vendedora: 'Ana', quantidadeChips: 1, valoresUnitarios: 'R$ 20,00' };
  const montarLinha = clienteDaBase => montarLinhaXlsxVenda(
    { cliente_da_base: clienteDaBase },
    detalhes,
    false,
    'concluido',
    new Map()
  );

  assert.equal(montarLinha(true).classificacao_cliente, 'Cliente base');
  assert.equal(montarLinha(false).classificacao_cliente, 'Cliente fora da base');
  assert.equal(montarLinha(null).classificacao_cliente, '');
});

test('exporta observacao vazia quando a movimentacao atual nao possui texto', () => {
  assert.equal(observacaoUltimaMovimentacaoExportacao({
    status_funil: 'entrega',
    historico: [
      { id: 1, status_anterior: 'analise', status_novo: 'entrega', observacao: 'Entrada antiga', created_at: '2026-08-01 10:00:00' },
      { id: 2, status_anterior: 'envio', status_novo: 'entrega', observacao: null, created_at: '2026-08-02 10:00:00' }
    ]
  }), '');
  assert.equal(observacaoUltimaMovimentacaoExportacao({ status_funil: null, historico: [] }), '');
});

test('repete a observacao nas linhas da venda e a oculta para venda restrita', () => {
  const venda = {
    id: 10,
    status_funil: 'entrega',
    historico: [{
      id: 1,
      status_anterior: 'analise',
      status_novo: 'entrega',
      observacao: 'Entrega confirmada',
      created_at: '2026-08-01 10:00:00'
    }]
  };
  const detalhes = [
    { vendedora: 'Ana', quantidadeChips: 2, valoresUnitarios: 'R$ 10,00' },
    { vendedora: 'Bia', quantidadeChips: 1, valoresUnitarios: 'R$ 20,00' }
  ];

  const linhas = detalhes.map(item => montarLinhaXlsxVenda(venda, item, false, 'concluido', new Map()));
  assert.deepEqual(linhas.map(linha => linha.observacao_movimentacao), ['Entrega confirmada', 'Entrega confirmada']);
  assert.equal(montarLinhaXlsxVenda(venda, detalhes[0], true, 'concluido', new Map()).observacao_movimentacao, '');
});

test('separa categorias e valores por vendedora em linhas de exportacao distintas', () => {
  const detalhes = montarDetalhesChipsExportacao({
    valores_unitarios_chips: [
      { quantidade: 2, gb: '20', tipo_linha: 'novo', valor_unitario: '29,90', vendedora_id: 10 },
      { quantidade: 1, gb: '40', tipo_linha: 'portabilidade', valor_unitario: '39,90', vendedora_id: 10 },
      { quantidade: 1, gb: '40', tipo_linha: 'portabilidade', valor_unitario: 49.9, vendedora_id: 11 }
    ],
    vendedoras: [
      { id: 10, nome: 'Ana' },
      { id: 11, nome: 'Bia' }
    ]
  });

  assert.deepEqual(detalhes, [
    { vendedora: 'Ana', quantidadeChips: 2, tiposLinha: 'Novo', gb: '20', valoresUnitarios: 'R$ 29,90', valorTotal: 59.8, quantidadeLinhas: 1 },
    { vendedora: 'Ana', quantidadeChips: 1, tiposLinha: 'Portabilidade', gb: '40', valoresUnitarios: 'R$ 39,90', valorTotal: 39.9, quantidadeLinhas: 1 },
    { vendedora: 'Bia', quantidadeChips: 1, tiposLinha: 'Portabilidade', gb: '40', valoresUnitarios: 'R$ 49,90', valorTotal: 49.9, quantidadeLinhas: 1 }
  ]);

  assert.deepEqual(
    detalhes.map(item => {
      const linha = montarLinhaXlsxVenda({ valor_total: 149.6 }, item, false, 'concluido', new Map());
      return { tipo: linha.tipo, gb: linha.gb, valorTotal: linha.valor_total };
    }),
    [
      { tipo: 'Novo', gb: '20', valorTotal: 59.8 },
      { tipo: 'Portabilidade', gb: '40', valorTotal: 39.9 },
      { tipo: 'Portabilidade', gb: '40', valorTotal: 49.9 }
    ]
  );
});

test('marca vendedora nao informada em venda compartilhada legada', () => {
  const detalhes = montarDetalhesChipsExportacao({
    valores_unitarios_chips: '2x49,90',
    vendedoras: [
      { id: 10, nome: 'Ana' },
      { id: 11, nome: 'Bia' }
    ]
  });

  assert.deepEqual(detalhes, [
    { vendedora: 'Não informado', quantidadeChips: 2, tiposLinha: 'Novo', gb: '', valoresUnitarios: 'R$ 49,90', valorTotal: 99.8, quantidadeLinhas: 1 }
  ]);
});

test('nao lista vendedoras por virgula quando venda compartilhada legada nao tem grupos salvos', () => {
  const detalhes = montarDetalhesChipsExportacao({
    quantidade_linhas: 4,
    vendedoras: [
      { id: 10, nome: 'Natalia' },
      { id: 11, nome: 'Thayara' }
    ]
  });

  assert.deepEqual(detalhes, [
    { vendedora: 'Não informado', quantidadeChips: 4, tiposLinha: '', valoresUnitarios: '—', valorTotal: null, quantidadeLinhas: 1 }
  ]);

  assert.equal(
    montarLinhaXlsxVenda({ valor_total: 240 }, detalhes[0], false, 'concluido', new Map()).valor_total,
    240
  );
});

test('consolida apenas itens com a mesma categoria, gb e valor unitario', () => {
  const detalhes = montarDetalhesChipsExportacao({
    valores_unitarios_chips: [
      { quantidade: 1, gb: '25', tipo_linha: 'novo', valor_unitario: 29.9 },
      { quantidade: 2, gb: '25', tipo_linha: 'novo', valor_unitario: 29.9 },
      { quantidade: 1, gb: '50', tipo_linha: 'novo', valor_unitario: 29.9 },
      { quantidade: 2, gb: '25', tipo_linha: 'novo', valor_unitario: 49.9 },
      { quantidade: 1, gb: '25', tipo_linha: 'portabilidade', valor_unitario: 29.9 }
    ],
    vendedora: { id: 10, nome: 'Ana' },
    vendedoras: [{ id: 10, nome: 'Ana' }]
  });

  assert.deepEqual(detalhes, [
    { vendedora: 'Ana', quantidadeChips: 3, tiposLinha: 'Novo', gb: '25', valoresUnitarios: 'R$ 29,90', valorTotal: 89.7, quantidadeLinhas: 1 },
    { vendedora: 'Ana', quantidadeChips: 1, tiposLinha: 'Novo', gb: '50', valoresUnitarios: 'R$ 29,90', valorTotal: 29.9, quantidadeLinhas: 1 },
    { vendedora: 'Ana', quantidadeChips: 2, tiposLinha: 'Novo', gb: '25', valoresUnitarios: 'R$ 49,90', valorTotal: 99.8, quantidadeLinhas: 1 },
    { vendedora: 'Ana', quantidadeChips: 1, tiposLinha: 'Portabilidade', gb: '25', valoresUnitarios: 'R$ 29,90', valorTotal: 29.9, quantidadeLinhas: 1 }
  ]);

  const linhas = detalhes.map(item => montarLinhaXlsxVenda(
    { valor_total: 999, quantidade_linhas: 7, gb: '25, 50' },
    item,
    false,
    'concluido',
    new Map()
  ));

  assert.deepEqual(linhas.map(linha => ({
    quantidade: linha.quantidade_chips_vendedora,
    linhas: linha.quantidade_linhas,
    tipo: linha.tipo,
    gb: linha.gb,
    valorUnitario: linha.valores_unitarios_chips,
    valorTotal: linha.valor_total
  })), [
    { quantidade: 3, linhas: 7, tipo: 'Novo', gb: '25', valorUnitario: 'R$ 29,90', valorTotal: 89.7 },
    { quantidade: 1, linhas: 7, tipo: 'Novo', gb: '50', valorUnitario: 'R$ 29,90', valorTotal: 29.9 },
    { quantidade: 2, linhas: 7, tipo: 'Novo', gb: '25', valorUnitario: 'R$ 49,90', valorTotal: 99.8 },
    { quantidade: 1, linhas: 7, tipo: 'Portabilidade', gb: '25', valorUnitario: 'R$ 29,90', valorTotal: 29.9 }
  ]);
});

test('usa o tipo geral da venda apenas como fallback para chips legados sem grupos', () => {
  const venda = {
    quantidade_linhas: 2,
    tipoVenda: { nome: 'Portabilidade' },
    vendedora: { id: 10, nome: 'Ana' }
  };
  const [detalhes] = montarDetalhesChipsExportacao(venda);

  assert.equal(detalhes.tiposLinha, 'Portabilidade');
  assert.equal(montarLinhaXlsxVenda(venda, detalhes, false, 'concluido', new Map()).tipo, 'Portabilidade');
});

test('mapeia tipo de venda para fallback dos chips exibidos na tabela', () => {
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Novo'), 'novo');
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Portabilidade'), 'portabilidade');
  assert.equal(obterTipoLinhaPorNomeTipoVenda('Venda especial'), '');
});

test('monta payload calculando totais, gb, datas e prioridade', () => {
  const payload = montarPayload({
    nome: '  Cliente Teste  ',
    quantidade_linhas: '3',
    prioridade_funil: 'urgente',
    data_venda: '18/05/2026',
    data_ativacao: '',
    numeros_ativados: '11999990000',
    valores_unitarios_chips: [
      { quantidade: 2, gb: '25GB', tipo_linha: 'Novo', valor_unitario: '59,90', operadora_atual_id: 2, operadora_id: 5, operadora_nome: 'Claro' },
      { quantidade: 1, gb: '50', tipo_linha: 'Portabilidade', valor_unitario: '79,90', operadora_atual_id: 3, operadora_id: 6, operadora_nome: 'TIM' }
    ],
    cliente_solicitou_servicos: ['bloqueio'],
    cliente_solicitou_bloqueio_qtd: '1',
    cliente_solicitou_numeros: { bloqueio: ['11999990000'], cancelamento: ['11888880000'] },
    cliente_solicitou_resolvido: 'sim',
    cliente_solicitou_resolvido_em: '18/05/2026',
    cliente_solicitou_protocolo_atendimento: '  ABC123  '
  });

  assert.equal(payload.nome, 'Cliente Teste');
  assert.equal(payload.quantidade_linhas, 3);
  assert.equal(payload.prioridade_funil, 'media');
  assert.equal(payload.data_venda, '2026-05-18');
  assert.equal(payload.data_ativacao, null);
  assert.equal(payload.numeros_ativados, null);
  assert.equal(payload.valor_total, 199.7);
  assert.equal(payload.gb, '25, 50');
  assert.deepEqual(
    JSON.parse(payload.valores_unitarios_chips).map(item => item.operadora_atual_id),
    [2, 3]
  );
  assert.deepEqual(
    JSON.parse(payload.valores_unitarios_chips).map(item => item.operadora_id),
    [5, 6]
  );
  assert.equal(payload.cliente_solicitou_bloqueio_qtd, 1);
  assert.deepEqual(JSON.parse(payload.cliente_solicitou_numeros), {
    bloqueio: ['11999990000'],
    cancelamento: []
  });
  assert.equal(payload.cliente_solicitou_resolvido_em, '2026-05-18');
  assert.equal(payload.cliente_solicitou_protocolo_atendimento, 'ABC123');
});

test('montarPayload impede mais chips do que linhas fechadas', () => {
  assert.throws(() => montarPayload({
    quantidade_linhas: 1,
    valores_unitarios_chips: [{ quantidade: 2, valor_unitario: 50 }]
  }), /quantidade de chips/i);
});

test('valida vendedoras atribuidas nos chips em venda compartilhada', () => {
  assert.doesNotThrow(() => validarVendedorasNosChips({
    valores_unitarios_chips: [
      { quantidade: 1, valor_unitario: 50, vendedora_id: 10 },
      { quantidade: 1, valor_unitario: 50, vendedora_id: 11 }
    ]
  }, [10, 11]));

  assert.throws(() => validarVendedorasNosChips({
    valores_unitarios_chips: [{ quantidade: 1, valor_unitario: 50, vendedora_id: 12 }]
  }, [10, 11]), /vendedoras selecionadas/i);

  assert.throws(() => validarVendedorasNosChips({
    valores_unitarios_chips: [{ quantidade: 1, valor_unitario: 50, vendedora_id: 10 }]
  }, [10, 11]), /pelo menos um chip/i);
});

test('aplica dados do cliente sem sobrescrever campos ja preenchidos', () => {
  const payload = aplicarDadosClienteNaVenda({ nome: 'Venda Manual' }, {
    nome: 'Cliente Base',
    razao_social: 'Razao Base',
    cnpj: '11222333000181',
    email: 'cliente@test.local',
    whatsapp_ddd: '11',
    whatsapp_numero: '999990000',
    responsavel_tipo: 'rl',
    responsavel_nome: 'Responsavel Legal'
  });

  assert.equal(payload.nome, 'Venda Manual');
  assert.equal(payload.razao_social, 'Razao Base');
  assert.equal(payload.telefone, '11999990000');
  assert.equal(payload.nome_representante_legal, 'Responsavel Legal');
  assert.equal(payload.email_representante_legal, 'cliente@test.local');
});

test('aplica operadora atual do cliente casando com operadora da venda', () => {
  const payload = aplicarDadosClienteNaVenda({ operadora_id: 7 }, {
    nome: 'Cliente Multi',
    responsavel_tipo: 'adm',
    operadoras_atuais: [
      { operadora_id: 5 },
      { operadora_id: 7 }
    ]
  });

  assert.equal(payload.operadora_atual_id, 7);

  const manual = aplicarDadosClienteNaVenda({ operadora_id: 7, operadora_atual_id: 9 }, {
    nome: 'Cliente Multi',
    responsavel_tipo: 'adm',
    operadoras_atuais: [{ operadora_id: 7 }]
  });

  assert.equal(manual.operadora_atual_id, 9);
});

test('obtem quantidade de chips com fallback para quantidade de linhas ou 1', () => {
  assert.equal(obterQuantidadeChipsVenda({
    valores_unitarios_chips: JSON.stringify([{ quantidade: 2 }, { quantidade: 3 }]),
    quantidade_linhas: 10
  }), 5);
  assert.equal(obterQuantidadeChipsVenda({ valores_unitarios_chips: '', quantidade_linhas: 4 }), 4);
  assert.equal(obterQuantidadeChipsVenda({}), 1);
});

test('atribui receita do ranking por vendedora de cada chip', () => {
  const usuarios = new Map([
    [1, { id: 1, nome: 'Ana', email: 'ana@test.local' }],
    [2, { id: 2, nome: 'Bia', email: 'bia@test.local' }]
  ]);

  const atribuicoes = montarAtribuicoesVendedorasVenda({
    vendedora_id: 1,
    vendedora_nome: 'Ana antiga',
    valor_total: 329.98,
    quantidade_linhas: 2,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, valor_unitario: 299.99, vendedora_id: 1 },
      { quantidade: 1, valor_unitario: 29.99, vendedora_id: 2 }
    ])
  }, usuarios);

  assert.deepEqual(atribuicoes, [
    { id: 1, nome: 'Ana', email: 'ana@test.local', valor: 299.99, chips: 1 },
    { id: 2, nome: 'Bia', email: 'bia@test.local', valor: 29.99, chips: 1 }
  ]);
});

test('filtra relatorio por vendedora usando apenas a receita dos chips dela', () => {
  const vendas = filtrarVendasRelatorioPorVendedora([{
    id: 18,
    vendedora_id: 1,
    vendedora_nome: 'Ana',
    valor_total: 329.98,
    quantidade_linhas: 2,
    valores_unitarios_chips: [
      { quantidade: 1, valor_unitario: 299.99, vendedora_id: 1 },
      { quantidade: 1, valor_unitario: 29.99, vendedora_id: 2 }
    ]
  }], 2, new Map([[2, { id: 2, nome: 'Bia', email: 'bia@test.local' }]]));

  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].valor_total, 29.99);
  assert.equal(vendas[0].quantidade_linhas, 1);
  assert.equal(obterQuantidadeChipsVenda(vendas[0]), 1);
  assert.equal(vendas[0].vendedora_id, 2);
});

test('calcula fidelidade 24 meses apos a conclusao preservando fim de mes', () => {
  assert.equal(adicionarMesesDataISO('2026-05-19', 24), '2028-05-19');
  assert.equal(adicionarMesesDataISO('2026-02-28', 24), '2028-02-28');
  assert.equal(adicionarMesesDataISO('2026-01-31', 1), '2026-02-28');
});

test('monta sincronizacao substituindo dados da operadora vendida', () => {
  const dados = montarDadosSincronizacaoClienteVenda({
    cliente_id: 10,
    operadora_id: 5,
    operadora_atual_id: 5,
    data_ativacao: '2026-05-19',
    valor_total: '119.80',
    quantidade_linhas: 8,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 2, valor_unitario: 59.9 }
    ])
  }, '2026-05-20');

  assert.deepEqual(dados, {
    clienteId: 10,
    operadoraVendidaId: 5,
    quantidadeChips: 2,
    valorPago: 119.8,
    fidelidadeFim: '2028-05-19',
    dataBase: '2026-05-19'
  });
});

test('monta sincronizacao para adicionar operadora diferente sem remover antigas', () => {
  const dados = montarDadosSincronizacaoClienteVenda({
    cliente_id: 10,
    operadora_id: 7,
    operadora_atual_id: 5,
    valor_total: 89.9,
    quantidade_linhas: 1
  }, '2026-05-20 14:30:00');

  assert.equal(dados.operadoraVendidaId, 7);
  assert.equal(dados.quantidadeChips, 1);
  assert.equal(dados.valorPago, 89.9);
  assert.equal(dados.fidelidadeFim, '2028-05-20');
});

test('nao monta sincronizacao sem cliente ou sem operadora vendida', () => {
  assert.equal(montarDadosSincronizacaoClienteVenda({ cliente_id: 10 }), null);
  assert.equal(montarDadosSincronizacaoClienteVenda({ operadora_id: 5 }), null);
});

test('oculta venda concluida parada por dois meses de calendario no funil', () => {
  const referencia = new Date('2026-05-18T12:00:00Z');

  assert.equal(
    obterDataLimiteConcluidaAntiga(referencia).toISOString(),
    '2026-03-18T12:00:00.000Z'
  );
  assert.equal(
    obterUltimaAtividadeFunil({
      ultima_atividade_em: null,
      updated_at: '2026-03-18 12:00:01',
      created_at: '2026-05-01 12:00:00'
    }).toISOString(),
    '2026-03-18T12:00:01.000Z'
  );

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-03-18 12:00:01'
  }, 'concluido', referencia), true);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-03-18 12:00:00'
  }, 'concluido', referencia), false);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-03-18 11:59:59'
  }, 'concluido', referencia), false);

  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'ativacao',
    ultima_atividade_em: '2026-04-01 12:00:00'
  }, 'concluido', referencia), true);
});

test('limite de dois meses ajusta o dia ao fim do mes de destino', () => {
  const referencia = new Date('2026-04-30T12:00:00Z');
  assert.equal(
    obterDataLimiteConcluidaAntiga(referencia).toISOString(),
    '2026-02-28T12:00:00.000Z'
  );
  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-02-28 12:00:00'
  }, 'concluido', referencia), false);
  assert.equal(vendaDeveAparecerNoFunil({
    status_funil: 'concluido',
    ultima_atividade_em: '2026-02-28 12:00:01'
  }, 'concluido', referencia), true);
});

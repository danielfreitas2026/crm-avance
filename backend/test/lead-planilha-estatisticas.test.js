const test = require('node:test');
const assert = require('node:assert/strict');

const { _internals } = require('../src/services/lead-planilha.service');

const {
  dataIsoEstatisticas,
  dataNaJanelaAtribuicao,
  primeiraAcaoDaAtribuicao,
  avaliarLinhaEstatistica,
  linhasDaCoorte,
  agregarEstatisticas,
  somarResumosEstatistica
} = _internals;

const PERIODO_FEVEREIRO = { data_inicio: '2025-02-01', data_fim: '2025-02-28' };
const REFERENCIA = new Date('2025-04-01T00:00:00Z');

function linha(overrides = {}) {
  return {
    id: overrides.id || 1,
    estatistica_usuario_id: overrides.estatistica_usuario_id || 10,
    estatistica_usuario_nome: overrides.estatistica_usuario_nome || 'Consultora',
    recebido_em: '2025-02-10T12:00:00Z',
    estatistica_primeira_acao_em: null,
    tentativas_conhecidas: 0,
    estatistica_distribuicao: {},
    ...overrides
  };
}

function agruparPorUsuario(linhas, filtros = PERIODO_FEVEREIRO) {
  return agregarEstatisticas(linhas, filtros, item => ({
    id: item.estatistica_usuario_id,
    usuario_id: item.estatistica_usuario_id,
    usuario_nome: item.estatistica_usuario_nome
  }));
}

test('datas das estatisticas respeitam a virada do dia em Sao Paulo', () => {
  assert.equal(dataIsoEstatisticas('2025-02-10T02:59:59Z'), '2025-02-09');
  assert.equal(dataIsoEstatisticas('2025-02-10T03:00:00Z'), '2025-02-10');
});

test('primeira acao usa o instante da auditoria e ignora a data futura do retorno', () => {
  const atribuicao = linha({
    recebido_em: '2025-02-10T12:00:00Z',
    retorno_agendado_em: '2025-03-20T15:00:00Z',
    estatistica_atribuicao_status: 'atribuido'
  });
  const auditorias = [{
    acao: 'lead_linha.retorno_marcado_admin',
    created_at: '2025-02-10T13:00:00Z'
  }];

  assert.equal(
    primeiraAcaoDaAtribuicao(atribuicao, auditorias),
    '2025-02-10T13:00:00Z'
  );
  assert.equal(primeiraAcaoDaAtribuicao(atribuicao, []), null);
});

test('auditorias de um lead reenviado ficam somente na janela da atribuicao correta', () => {
  const primeira = linha({ recebido_em: '2025-02-01T12:00:00Z' });
  const segunda = linha({ recebido_em: '2025-02-10T12:00:00Z' });
  const auditorias = [
    { created_at: '2025-02-02T12:00:00Z' },
    { created_at: '2025-02-11T12:00:00Z' },
    { created_at: '2025-02-12T12:00:00Z' }
  ];
  const primeiraJanela = auditorias.filter(item => dataNaJanelaAtribuicao(
    item.created_at,
    primeira.recebido_em,
    segunda.recebido_em
  ));
  const segundaJanela = auditorias.filter(item => dataNaJanelaAtribuicao(
    item.created_at,
    segunda.recebido_em,
    null
  ));

  assert.equal(primeiraJanela.length, 1);
  assert.equal(segundaJanela.length, 2);
  assert.equal(primeiraAcaoDaAtribuicao(primeira, primeiraJanela, segunda.recebido_em), '2025-02-02T12:00:00Z');
  assert.equal(primeiraAcaoDaAtribuicao(segunda, segundaJanela), '2025-02-11T12:00:00Z');
});

test('coorte exclui backlog e fecha leads trabalhados ou pendentes na data final', () => {
  const linhas = [
    linha({ id: 1, recebido_em: '2025-01-20T12:00:00Z', estatistica_primeira_acao_em: '2025-02-02T12:00:00Z' }),
    linha({ id: 2, estatistica_primeira_acao_em: '2025-02-11T12:00:00Z' }),
    linha({ id: 3, estatistica_primeira_acao_em: '2025-03-01T12:00:00Z' }),
    linha({ id: 4 })
  ];

  const [resumo] = agruparPorUsuario(linhas);

  assert.equal(resumo.recebidos, 3);
  assert.equal(resumo.trabalhados, 1);
  assert.equal(resumo.pendentes, 2);
  assert.equal(resumo.produtividade_pct, 33.3);
  assert.equal(resumo.trabalhados + resumo.pendentes, resumo.recebidos);
  assert.ok(resumo.produtividade_pct >= 0 && resumo.produtividade_pct <= 100);
});

test('acao posterior ao fechamento permanece pendente no relatorio historico', () => {
  const avaliacao = avaliarLinhaEstatistica(
    linha({ estatistica_primeira_acao_em: '2025-03-01T02:59:59Z' }),
    PERIODO_FEVEREIRO,
    REFERENCIA
  );

  assert.equal(dataIsoEstatisticas('2025-03-01T02:59:59Z'), '2025-02-28');
  assert.equal(avaliacao.trabalhada, true);

  const posterior = avaliarLinhaEstatistica(
    linha({ estatistica_primeira_acao_em: '2025-03-01T03:00:00Z' }),
    PERIODO_FEVEREIRO,
    REFERENCIA
  );
  assert.equal(posterior.trabalhada, false);
});

test('atribuicao sem acao propria nao reutiliza o resultado atual de outro reenvio', () => {
  const avaliacao = avaliarLinhaEstatistica(
    linha({
      estatistica_primeira_acao_em: null,
      futuro_cliente_marcado_em: '2025-02-15T12:00:00Z'
    }),
    PERIODO_FEVEREIRO,
    REFERENCIA
  );

  assert.equal(avaliacao.trabalhada, false);
});

test('detalhamento e exportacao recebem somente linhas da coorte e ocultam acao posterior', () => {
  const coorte = linhasDaCoorte([
    linha({ id: 1, recebido_em: '2025-01-31T12:00:00Z', estatistica_primeira_acao_em: '2025-02-01T12:00:00Z' }),
    linha({ id: 2, estatistica_primeira_acao_em: '2025-02-11T12:00:00Z' }),
    linha({ id: 3, estatistica_primeira_acao_em: '2025-03-02T12:00:00Z' })
  ], PERIODO_FEVEREIRO, REFERENCIA);

  assert.deepEqual(coorte.map(item => item.id), [2, 3]);
  assert.equal(coorte[0].estatistica_primeira_acao_considerada_em, '2025-02-11T12:00:00Z');
  assert.equal(coorte[1].estatistica_primeira_acao_considerada_em, null);
});

test('total geral usa volumes somados em vez da media dos percentuais', () => {
  const usuarios = agruparPorUsuario([
    linha({ id: 1, estatistica_usuario_id: 1, estatistica_primeira_acao_em: '2025-02-11T12:00:00Z' }),
    linha({ id: 2, estatistica_usuario_id: 2, estatistica_primeira_acao_em: '2025-02-11T12:00:00Z' }),
    linha({ id: 3, estatistica_usuario_id: 2 }),
    linha({ id: 4, estatistica_usuario_id: 2 })
  ]);
  const total = somarResumosEstatistica(usuarios);

  assert.deepEqual(usuarios.map(item => item.produtividade_pct), [100, 33.3]);
  assert.equal(total.recebidos, 4);
  assert.equal(total.trabalhados, 2);
  assert.equal(total.pendentes, 2);
  assert.equal(total.produtividade_pct, 50);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals: stats } = require('../src/services/lead-estatisticas.service');
const { montarMovimentacoes, filtrarMovimentacoes, resumirMovimentacoes, agruparMovimentacoes,
  paginarLinhas, montarWorkbook, dataIsoEstatisticas, validarPeriodo } = stats;
const FEVEREIRO = { data_inicio: '2025-02-01', data_fim: '2025-02-28' };
function fontes(extra = {}) {
  return { linhas: [{ id: 1, dados_json: { Empresa: 'Loja antiga' }, updated_at: '2025-05-20T12:00:00Z' }],
    atribuicoes: [{ id: 10, lead_linha_id: 1, usuario_id: 7, usuario_nome: 'Qualificadora',
      envio_id: 100, envio_nome: 'Mailing de janeiro', atribuido_em: '2025-01-10T12:00:00Z' }], ...extra };
}
function audit(id, acao, data, extra = {}) {
  return { id, entidade_id: '1', usuario_id: 9, usuario_nome: 'Administradora',
    acao: 'lead_linha.' + acao, created_at: data, ...extra };
}
function periodo(dados, filtros = FEVEREIRO) { return filtrarMovimentacoes(montarMovimentacoes(dados), filtros); }

test('ações de mailing antigo aparecem nos respectivos dias e preservam autor e qualificadora', () => {
  const dados = fontes({ auditorias: [
    audit(1, 'chamada_nao_atendida', '2025-02-10T12:00:00Z'),
    audit(2, 'retorno_marcado', '2025-02-11T12:00:00Z')
  ] });
  const dia = valor => periodo(dados, { data_inicio: valor, data_fim: valor });
  assert.deepEqual(dia('2025-02-10').map(item => item.tipo), ['chamada_nao_atendida']);
  assert.deepEqual(dia('2025-02-11').map(item => item.tipo), ['retorno_agendado']);
  const eventos = periodo(dados), resumo = resumirMovimentacoes(eventos);
  assert.equal(resumo.clientes_movimentados, 1);
  assert.equal(resumo.total_acoes, 2);
  assert.equal(eventos[0].responsavel_id, 7);
  assert.equal(eventos[0].envio_id, 100);
  assert.equal(eventos[0].autor.nome, 'Administradora');
});

test('cadastro único não é repetido por edições explícitas ou auditorias legadas', () => {
  const dados = fontes({ linhas: [{ id: 1, futuro_cliente_marcado_em: '2025-02-10T12:00:00Z' }],
    auditorias: [audit(1, 'futuro_cliente_marcado', '2025-02-10T12:00:01Z'),
      audit(2, 'futuro_cliente_atualizado_admin', '2025-02-11T12:00:00Z'),
      audit(3, 'futuro_cliente_marcado', '2025-02-12T12:00:00Z')] });
  const resumo = resumirMovimentacoes(periodo(dados));
  assert.equal(resumo.futuros_clientes_adicionados, 1);
  assert.equal(resumo.acoes_por_tipo.atualizacao, 2);
  assert.equal(resumo.total_acoes, 3);
  assert.equal(resumirMovimentacoes(periodo(dados, { data_inicio: '2025-02-11' })).futuros_clientes_adicionados, 0);
});

test('agendamento usa ocorrido_em da auditoria sem usar a data futura ou updated_at', () => {
  const dados = fontes({ linhas: [{ id: 1, retorno_agendado_em: '2025-04-10T12:00:00Z', updated_at: '2025-02-20T12:00:00Z' }],
    auditorias: [audit(1, 'retorno_marcado', '2025-02-11T13:00:00Z',
      { dados: JSON.stringify({ ocorrido_em: '2025-02-10 12:00:00' }) })] });
  assert.equal(periodo(dados)[0].ocorrido_em, '2025-02-10T12:00:00.000Z');
  assert.equal(periodo(dados, { data_inicio: '2025-04-01' }).length, 0);
  assert.equal(periodo(fontes({ linhas: dados.linhas })).length, 0);
});

test('auditoria inicial atrasada continua sendo um único cadastro, sem atualização fictícia', () => {
  const dados = fontes({ linhas: [{ id: 1, futuro_cliente_marcado_em: '2025-02-10T12:00:00Z' }],
    auditorias: [audit(1, 'futuro_cliente_marcado', '2025-02-11T12:00:00Z')] });
  const eventos = periodo(dados);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'futuro_cliente_adicionado');
  assert.equal(eventos[0].ocorrido_em, '2025-02-10T12:00:00.000Z');
});

test('reenvio usa a janela correta e total geral conta clientes distintos entre responsáveis', () => {
  const dados = fontes();
  dados.atribuicoes.push({ ...dados.atribuicoes[0], id: 11, usuario_id: 8, envio_id: 101, atribuido_em: '2025-02-11T12:00:00Z' });
  dados.auditorias = [audit(1, 'chamada_nao_atendida', '2025-02-10T12:00:00Z'),
    audit(2, 'retorno_marcado', '2025-02-11T12:00:00Z')];
  const eventos = periodo(dados);
  assert.deepEqual(eventos.map(item => item.responsavel_id), [7, 8]);
  assert.equal(filtrarMovimentacoes(eventos, { usuario_id: 7 }).length, 1);
  assert.deepEqual(agruparMovimentacoes(eventos, item => ({ id: item.responsavel_id })).map(item => item.clientes_movimentados), [1, 1]);
  assert.equal(resumirMovimentacoes(eventos).clientes_movimentados, 1);
});

test('retornos automático e manual ao Telegram não repetem primeiro envio', () => {
  const eventos = periodo(fontes({ publicacoes: [
    { id: 1, lead_linha_id: 1, tipo: 'primeiro_envio', publicado_em: '2025-02-10T12:00:00Z' },
    { id: 2, lead_linha_id: 1, tipo: 'republicacao', publicado_em: '2025-02-12T12:00:00Z' },
    { id: 3, lead_linha_id: 1, tipo: 'republicacao', publicado_em: '2025-02-14T12:00:00Z' }
  ], distribuicoes: [{ id: 20, lead_linha_id: 1, usuario_id: 9, usuario_nome: 'Consultora',
    aceite_em: '2025-02-10T13:00:00Z', finalizado_em: '2025-02-11T12:00:00Z', aceite_status: 'expirado_sem_acao' }] }));
  assert.equal(resumirMovimentacoes(eventos).novos_envios_telegram, 1);
  assert.equal(resumirMovimentacoes(filtrarMovimentacoes(eventos, { data_inicio: '2025-02-12' })).novos_envios_telegram, 0);
  assert.equal(resumirMovimentacoes(eventos).acoes_por_tipo.retorno_telegram, 2);
  assert.equal(eventos.find(item => item.tipo === 'aceite_telegram').responsavel_id, 7);
});

test('legado com data desconhecida não inventa ação nem novo envio', () => {
  const eventos = periodo(fontes({ publicacoes: [
    { id: 1, lead_linha_id: 1, tipo: 'legado', publicado_em: null },
    { id: 2, lead_linha_id: 1, tipo: 'legado', publicado_em: '2025-02-10T12:00:00Z' }
  ] }));
  assert.equal(eventos.length, 1);
  assert.equal(resumirMovimentacoes(eventos).novos_envios_telegram, 0);
  assert.equal(resumirMovimentacoes(eventos).historico_incompleto, true);
});

test('clientes enviados inclui 58 legados confirmados e 8 primeiros envios sem duplicar reenvios', () => {
  const dados = fontes({ linhas: [], atribuicoes: [], publicacoes: [] });
  for (let id = 1; id <= 66; id++) {
    dados.linhas.push({ id, futuro_cliente_marcado_em: '2025-02-10T11:00:00Z' });
    dados.atribuicoes.push({ id, lead_linha_id: id, usuario_id: 7, envio_id: 100,
      atribuido_em: '2025-01-10T12:00:00Z' });
    dados.publicacoes.push({ id, lead_linha_id: id, tipo: id <= 8 ? 'primeiro_envio' : 'legado',
      telegram_chat_id: 'grupo-teste', telegram_message_id: String(id), publicado_em: '2025-02-10T12:00:00Z' });
  }
  dados.publicacoes.push({ id: 67, lead_linha_id: 1, tipo: 'republicacao',
    telegram_chat_id: 'grupo-teste', telegram_message_id: '67', publicado_em: '2025-02-12T12:00:00Z' });
  const eventos = periodo(dados);
  const resumo = resumirMovimentacoes(eventos);
  assert.equal(resumo.clientes_enviados_telegram, 66);
  assert.equal(resumo.novos_envios_telegram, 8);
  assert.equal(resumirMovimentacoes(periodo(dados, {
    data_inicio: '2025-02-12', data_fim: '2025-02-12'
  })).clientes_enviados_telegram, 1);
  assert.equal(resumirMovimentacoes(periodo(dados, {
    data_inicio: '2025-03-01', data_fim: '2025-03-31'
  })).clientes_enviados_telegram, 0);
  const workbook = montarWorkbook(dados.linhas, eventos, true);
  for (const nome of ['Resumo', 'Resumo por usuário', 'Mailings']) {
    const sheet = workbook.getWorksheet(nome);
    const coluna = sheet.getRow(1).values.indexOf('Clientes enviados ao Telegram');
    assert.ok(coluna > 0, nome);
    assert.equal(sheet.getCell(2, coluna).value, 66, nome);
  }
});

test('clientes enviados exige mensagem e data válidas, sem inferir envio pelo destino ou solicitação', () => {
  for (const tipo of ['primeiro_envio', 'republicacao', 'legado']) {
    for (const extra of [
      { publicado_em: null }, { publicado_em: 'inválida' }, { publicado_em: '0000-00-00 00:00:00' },
      { telegram_chat_id: null }, { telegram_chat_id: ' ' },
      { telegram_message_id: null }, { telegram_message_id: ' ' }
    ]) {
      const dados = fontes({ linhas: [{ id: 1, futuro_cliente_destino: 'distribuicao' }],
        auditorias: [audit(1, 'futuro_cliente_enviado_distribuicao', '2025-02-10T12:00:00Z')],
        publicacoes: [{ id: 1, lead_linha_id: 1, tipo, telegram_chat_id: 'grupo-teste',
          telegram_message_id: '100', publicado_em: '2025-02-10T12:00:00Z', ...extra }] });
      assert.equal(resumirMovimentacoes(periodo(dados)).clientes_enviados_telegram, 0,
        `${tipo}: ${JSON.stringify(extra)}`);
    }
  }
});

test('clientes enviados conserva devoluções e deduplica o total entre responsáveis e mailings', () => {
  const dados = fontes({ publicacoes: [
    { id: 1, lead_linha_id: 1, tipo: 'legado', telegram_chat_id: 'grupo-teste',
      telegram_message_id: '100', publicado_em: '2025-02-10T12:00:00Z' },
    { id: 2, lead_linha_id: 1, tipo: 'republicacao', telegram_chat_id: 'grupo-teste',
      telegram_message_id: '101', publicado_em: '2025-02-12T12:00:00Z' }
  ] });
  dados.atribuicoes.push({ ...dados.atribuicoes[0], id: 11, usuario_id: 8,
    envio_id: 101, atribuido_em: '2025-02-11T12:00:00Z' });
  for (const aceite_status of ['recusado', 'expirado_sem_aceite', 'expirado_sem_acao', 'cancelado']) {
    dados.distribuicoes = [{ id: 20, lead_linha_id: 1, aceite_status, finalizado_em: '2025-02-13T12:00:00Z' }];
    const eventos = periodo(dados);
    assert.equal(resumirMovimentacoes(eventos).clientes_enviados_telegram, 1);
    for (const filtros of [{ usuario_id: 7, envio_id: 100 }, { usuario_id: 8, envio_id: 101 }]) {
      assert.equal(resumirMovimentacoes(filtrarMovimentacoes(eventos, filtros)).clientes_enviados_telegram, 1);
    }
    assert.deepEqual(agruparMovimentacoes(eventos, item => ({ id: item.responsavel_id }))
      .map(item => item.clientes_enviados_telegram), [1, 1]);
  }
});

test('clientes enviados respeita o calendário de São Paulo e não conta confirmação futura', () => {
  const datas = ['2025-02-01T02:59:59Z', '2025-02-01T03:00:00Z',
    '2025-03-01T02:59:59Z', '2025-03-01T03:00:00Z', '2099-01-01T12:00:00Z'];
  const dados = fontes({ linhas: datas.map((_, i) => ({ id: i + 1 })),
    atribuicoes: datas.map((_, i) => ({ id: i + 1, lead_linha_id: i + 1, usuario_id: 7,
      envio_id: 100, atribuido_em: '2025-01-01T12:00:00Z' })),
    publicacoes: datas.map((publicado_em, i) => ({ id: i + 1, lead_linha_id: i + 1, tipo: 'legado',
      telegram_chat_id: 'grupo-teste', telegram_message_id: String(i + 1), publicado_em })) });
  assert.equal(resumirMovimentacoes(periodo(dados)).clientes_enviados_telegram, 2);
  assert.equal(resumirMovimentacoes(periodo(dados, {})).clientes_enviados_telegram, 4);
});

test('fonte repetida e fallback de campo não duplicam a mesma ação', () => {
  const dados = fontes({ linhas: [{ id: 1, chamada_nao_atendida_em: '2025-02-10T12:00:00Z' }],
    auditorias: [audit(1, 'chamada_nao_atendida', '2025-02-10T12:00:01Z')] });
  dados.linhas.push(dados.linhas[0]);
  assert.equal(periodo(dados).length, 1);
});

test('auditoria conserva retornos realizados depois de um novo agendamento', () => {
  const dados = fontes({ linhas: [{ id: 1, futuro_cliente_retorno: '2025-04-20T12:00:00Z', futuro_cliente_retorno_realizado_em: null }],
    auditorias: [audit(1, 'retorno_realizado', '2025-02-10T12:00:00Z'),
      audit(2, 'retorno_realizado', '2025-02-15T12:00:00Z')] });
  assert.equal(resumirMovimentacoes(periodo(dados)).acoes_por_tipo.retorno_realizado, 2);
});

test('auditoria atrasada depois da meia-noite usa o instante específico da ação sem duplicar', () => {
  const dados = fontes({ linhas: [{ id: 1, chamada_nao_atendida_em: '2025-03-01T02:59:59Z', chamada_nao_atendida_por_id: 9 }],
    auditorias: [audit(1, 'chamada_nao_atendida', '2025-03-01T03:00:10Z')] });
  dados.atribuicoes.push({ ...dados.atribuicoes[0], id: 11, usuario_id: 8, envio_id: 101, atribuido_em: '2025-03-01T03:00:00Z' });
  const fevereiro = periodo(dados);
  assert.equal(fevereiro.length, 1);
  assert.equal(fevereiro[0].ocorrido_em, '2025-03-01T02:59:59.000Z');
  assert.equal(fevereiro[0].responsavel_id, 7);
  assert.equal(fevereiro[0].envio_id, 100);
  assert.equal(periodo(dados, { data_inicio: '2025-03-01', data_fim: '2025-03-01' }).length, 0);
});

test('vínculos manuais e campos legados preservam o nome do autor conhecido', () => {
  const eventos = periodo(fontes({ linhas: [{ id: 1, chamada_nao_atendida_em: '2025-02-10T12:00:00Z', chamada_nao_atendida_por_id: 7 }],
    vinculos: [{ id: 1, lead_linha_id: 1, venda_id: 30, vinculado_por_id: 9, vinculado_em: '2025-02-11T12:00:00Z' }],
    usuarios: [{ id: 9, nome: 'Administradora' }] }));
  assert.equal(eventos[0].autor.nome, 'Qualificadora');
  assert.equal(eventos[1].autor.nome, 'Administradora');
});

test('venda usa criação, deduplica venda e separa vinculação manual de venda antiga', () => {
  const dados = fontes({ vendas: [
    { id: 30, origem_lead_linha_id: 1, created_at: '2025-02-10T12:00:00Z', data_venda: '2024-01-01', valor_total: 100 },
    { id: 31, origem_lead_linha_id: 1, created_at: '2025-01-15T12:00:00Z', valor_total: 200 }
  ], vinculos: [{ id: 1, lead_linha_id: 1, venda_id: 31, vinculado_em: '2025-02-12T12:00:00Z', vinculado_por_id: 9 }] });
  dados.vendas.push(dados.vendas[0]);
  const resumo = resumirMovimentacoes(periodo(dados));
  assert.equal(resumo.vendas_registradas, 1);
  assert.equal(resumo.valor_vendido, 100);
  assert.equal(resumo.acoes_por_tipo.venda_vinculada, 1);
});

test('fuso de São Paulo respeita limites inclusivos e exclui ações futuras', () => {
  assert.equal(dataIsoEstatisticas('2025-03-01T02:59:59Z'), '2025-02-28');
  assert.equal(dataIsoEstatisticas('2025-03-01T03:00:00Z'), '2025-03-01');
  const dados = fontes({ auditorias: [
    audit(1, 'chamada_nao_atendida', '2025-02-01T02:59:59Z'),
    audit(2, 'chamada_nao_atendida', '2025-02-01T03:00:00Z'),
    audit(3, 'chamada_nao_atendida', '2025-03-01T02:59:59Z'),
    audit(4, 'chamada_nao_atendida', '2025-03-01T03:00:00Z'),
    audit(5, 'chamada_nao_atendida', '2099-01-01T12:00:00Z')
  ] });
  assert.deepEqual(periodo(dados).map(item => item.id), ['auditoria:2', 'auditoria:3']);
  assert.equal(periodo(dados, {}).length, 4);
});

test('período vazio retorna zeros; datas inválidas e invertidas retornam erro 400', () => {
  assert.equal(resumirMovimentacoes(periodo(fontes())).clientes_movimentados, 0);
  for (const filtros of [{ data_inicio: '2025-03-01', data_fim: '2025-02-28' }, { data_inicio: '2025-02-30' }, { data_fim: 'ontem' }]) {
    assert.throws(() => validarPeriodo(filtros), error => error.statusCode === 400);
  }
});

test('detalhamento, busca, paginação e Excel compartilham eventos e totais', async () => {
  const dados = fontes({ auditorias: [audit(1, 'chamada_nao_atendida', '2025-02-10T12:00:00Z'),
    audit(2, 'retorno_marcado', '2025-03-10T12:00:00Z')] });
  const eventos = periodo(dados);
  const detalhes = paginarLinhas(dados.linhas, eventos, { busca: 'loja', page: 1, page_size: 1 });
  assert.equal(detalhes.total, 1);
  assert.equal(detalhes.resumo.total_acoes, 1);
  assert.equal(detalhes.data[0].ultima_movimentacao_em, '2025-02-10T12:00:00.000Z');
  assert.equal(detalhes.data[0].movimentacoes_periodo.length, 1);
  assert.equal(paginarLinhas(dados.linhas, eventos, { page: 2, page_size: 1 }).data.length, 0);
  assert.equal(paginarLinhas(dados.linhas, eventos, { busca: 'inexistente' }).total, 0);
  const workbook = montarWorkbook(dados.linhas, eventos, true);
  assert.equal(workbook.getWorksheet('Resumo').getCell('A2').value, 1);
  assert.equal(workbook.getWorksheet('Resumo').getCell('E2').value, 1);
  assert.equal(workbook.getWorksheet('Movimentações').rowCount, 2);
  assert.equal(workbook.getWorksheet('Movimentações').getCell('F2').value, 'Administradora');
  assert.match(workbook.getWorksheet('Clientes').getCell('B2').value, /09:00:00/);
  assert.ok((await workbook.xlsx.writeBuffer()).length > 0);
});

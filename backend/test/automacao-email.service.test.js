const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/services/vivo-email-parser.service');
const automacao = require('../src/services/automacao-email.service');
const FunilEtapa = require('../src/models/FunilEtapa');
const Venda = require('../src/models/Venda');
const vendaService = require('../src/services/venda.service');

const EMAIL_PROBLEMA = `Dados da Venda
ID: 301913
Tipo Pessoa: Pessoa Jur�dica
Data da Venda: 24/08/2026 08:50:33
CNPJ: 11.143.938/0001-87 (11143938000187)
Raz��o Social: AUTO PECAS INDIAIA LTDA
Nome Comercial: AUTO PECAS INDIAIA

Resumo da Venda
Indicador Quantidade Total Mensal Total Aparelho
Alta - Portabilidade 1 R$ 54,99 R$ 15,00
Total 1 R$ 54,99 R$ 15,00

Workflow (tramita��o do pedido)
Origem: An�lise da Qualidade e Auditoria
Mensagem ao Operador: 37991490023 - Chama ate cair por VVN, e nao possui WPP.
Destino: Corre��o do Pedido de Venda Pelo Consultor`;

const EMAIL_INPUT_REALIZADO = `Dados da Venda
ID: 303048
Tipo Pessoa: Pessoa Jur�dica
Data da Venda: 27/08/2026 14:30:59
CNPJ: 29.046.034/0001-07 (29046034000107)
Raz�o Social: SINDICATO RURAL DE PIRAI
Nome Comercial:

Resumo da Venda
Indicador Quantidade Total Mensal Total Aparelho
Alta - Terminais 4 R$ 399,96 R$ 60,00
Total 4 R$ 399,96 R$ 60,00

Workflow (tramita��o do pedido)
Origem: Aguardando Input Autom�tico
Mensagem ao Operador: 1-CG8LB6HL
Destino: Pend�ncia > Input Realizado com Sucesso`;

test('interpreta problema mesmo com acentos substituidos por caracteres invalidos', () => {
  assert.deepEqual(parser.interpretarEmail(EMAIL_PROBLEMA), {
    documento: '11143938000187', data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99,
    destino: 'Corre��o do Pedido de Venda Pelo Consultor',
    mensagem_operador: '37991490023 - Chama ate cair por VVN, e nao possui WPP.', classificacao: 'tipo_2', alvo: null
  });
});

test('interpreta input realizado com sucesso e direciona para aceite e biometria', () => {
  assert.deepEqual(parser.interpretarEmail(EMAIL_INPUT_REALIZADO), {
    documento: '29046034000107', data_venda: '2026-08-27', quantidade: 4, valor_mensal: 399.96,
    destino: 'Pend�ncia > Input Realizado com Sucesso',
    mensagem_operador: '1-CG8LB6HL', classificacao: 'tipo_1', alvo: 'aceite_biometria'
  });
});

test('mapeia os destinos de aceite e entrega com texto normal ou corrompido', () => {
  assert.deepEqual(parser.classificarDestino('Aguardando Aceite/Assinatura'), { classificacao: 'tipo_1', alvo: 'aceite_biometria' });
  assert.deepEqual(parser.classificarDestino('Vivocorp - Pedidos > Log�stica Conclu�da'), { classificacao: 'tipo_1', alvo: 'entrega' });
  assert.equal(parser.classificarDestino('Destino novo').classificacao, 'desconhecido');
});

test('registra as divergencias secundarias separadamente', () => {
  const campos = { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 };
  const venda = { data_venda: '2026-08-24', quantidade_linhas: 1, valor_total: 54.99, cancelada_em: null };
  assert.deepEqual(automacao._internals.divergenciasSecundarias(venda, campos), []);
  assert.deepEqual(automacao._internals.divergenciasSecundarias({ ...venda, data_venda: '2026-08-25' }, campos), ['data da venda divergente']);
  assert.deepEqual(automacao._internals.divergenciasSecundarias({ ...venda, quantidade_linhas: 2 }, campos), ['quantidade divergente']);
  assert.deepEqual(automacao._internals.divergenciasSecundarias({ ...venda, valor_total: 55 }, campos), ['valor mensal divergente']);
});

test('CNPJ com uma unica venda ativa prevalece sobre divergencias secundarias', () => {
  const venda = { id: 1, status_funil: 'ativacao', data_venda: '2026-08-25', quantidade_linhas: 2, valor_total: 100 };
  const resultado = automacao._internals.avaliarCandidatas(
    [venda],
    { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 },
    ['concluido']
  );
  assert.equal(resultado.venda, venda);
  assert.deepEqual(resultado.candidatas[0].divergencias, ['data da venda divergente', 'quantidade divergente', 'valor mensal divergente']);
  assert.equal(resultado.candidatas[0].elegivel, true);
});

test('varias vendas ativas exigem uma unica correspondencia secundaria completa', () => {
  const campos = { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 };
  const exata = { id: 1, status_funil: 'ativacao', data_venda: '2026-08-24', quantidade_linhas: 1, valor_total: 54.99 };
  const divergente = { id: 2, status_funil: 'entrega', data_venda: '2026-08-24', quantidade_linhas: 2, valor_total: 54.99 };
  const resultado = automacao._internals.avaliarCandidatas([exata, divergente], campos, ['concluido']);
  assert.equal(resultado.venda, exata);

  const empatadas = automacao._internals.avaliarCandidatas([exata, { ...exata, id: 3 }], campos, ['concluido']);
  assert.equal(empatadas.venda, null);

  const semCamposSecundarios = automacao._internals.avaliarCandidatas([exata, { ...exata, id: 3 }], {}, ['concluido']);
  assert.equal(semCamposSecundarios.venda, null);
  assert.deepEqual(semCamposSecundarios.candidatas[0].divergencias, []);

  const semCorrespondencia = automacao._internals.avaliarCandidatas(
    [{ ...exata, quantidade_linhas: 2 }, { ...exata, id: 3, valor_total: 100 }],
    campos,
    ['concluido']
  );
  assert.equal(semCorrespondencia.venda, null);
});

test('vendas concluidas, canceladas e excluidas nao participam da correspondencia', () => {
  const campos = { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 };
  const ativa = { id: 1, status_funil: 'entrega', data_venda: '2026-08-25', quantidade_linhas: 2, valor_total: 100 };
  const concluida = { ...ativa, id: 2, status_funil: 'final_personalizado' };
  const cancelada = { ...ativa, id: 3, cancelada_em: '2026-08-30' };
  const excluida = { ...ativa, id: 4, excluido_em: '2026-08-30' };
  const resultado = automacao._internals.avaliarCandidatas([concluida, cancelada, excluida, ativa], campos, ['final_personalizado']);
  assert.equal(resultado.venda, ativa);
  assert.deepEqual(resultado.candidatas.map(item => item.elegivel), [false, false, false, true]);
  assert.deepEqual(resultado.candidatas[0].inelegibilidades, ['venda concluída']);
});

test('documento com somente vendas finalizadas segue para revisao', () => {
  const resultado = automacao._internals.avaliarCandidatas([
    { id: 1, status_funil: 'concluido' },
    { id: 2, status_funil: 'entrega', cancelada_em: '2026-08-30' }
  ], {}, ['concluido']);
  assert.equal(resultado.venda, null);
  assert.match(resultado.erro, /concluídas, canceladas ou excluídas/);
});

test('revisao manual bloqueia venda concluida', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  Venda.query = () => ({
    findById: () => ({
      withGraphFetched: async () => ({ id: 9, status_funil: 'final_personalizado', excluido_em: null, cancelada_em: null })
    })
  });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'final_personalizado' }] });
  try {
    const resultado = await automacao._internals.resolverVenda({ revisado_por_id: 3, venda_id: 9 }, {});
    assert.equal(resultado.venda, null);
    assert.match(resultado.erro, /não pode receber atualizações/);
    assert.equal(resultado.candidatas[0].manual, true);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
  }
});

test('normaliza endereco do remetente sem aceitar nome de exibicao', () => {
  assert.equal(automacao._internals.emailRemetente('MS Gestor <workflow@vivo.example>'), 'workflow@vivo.example');
});

test('coleta historica ignora o cursor mais recente e respeita a data inicial', () => {
  const inicio = new Date('2026-08-20T03:00:00.000Z');
  const ultima = '2026-08-30T12:00:00.000Z';

  assert.equal(automacao._internals.calcularDepois(inicio, ultima, true), 1787194800);
  assert.equal(automacao._internals.calcularDepois(inicio, ultima, false), 1788090900);
});

test('usa especificamente o bot de aprovacoes para notificar problemas', () => {
  const tokenAprovacoesAnterior = process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
  const tokenGeralAnterior = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_APROVACOES_BOT_TOKEN = 'token-aprovacoes';
  process.env.TELEGRAM_BOT_TOKEN = 'token-geral';

  try {
    assert.equal(automacao._internals.tokenTelegramProblemas(), 'token-aprovacoes');
  } finally {
    if (tokenAprovacoesAnterior === undefined) delete process.env.TELEGRAM_APROVACOES_BOT_TOKEN;
    else process.env.TELEGRAM_APROVACOES_BOT_TOKEN = tokenAprovacoesAnterior;
    if (tokenGeralAnterior === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = tokenGeralAnterior;
  }
});

test('movimentacao processada pelo Gmail envia origem e id da automacao ao servico de vendas', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaService.atualizarStatusVenda;
  let chamada = null;
  let consultaEtapa = 0;

  Venda.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 41,
      status_funil: 'aceite',
      excluido_em: null,
      cancelada_em: null
    })
  });
  FunilEtapa.query = () => {
    consultaEtapa += 1;
    if (consultaEtapa === 1) {
      return { where: async () => [{ codigo: 'concluido' }] };
    }
    return {
      findOne: async filtros => filtros.codigo === 'entrega'
        ? { codigo: 'entrega', ordem: 3 }
        : { codigo: 'aceite', ordem: 2 }
    };
  };
  vendaService.atualizarStatusVenda = async (...args) => {
    chamada = args;
    return { status: 'ok' };
  };

  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 88,
      venda_id: 41,
      revisado_por_id: 7,
      corpo_texto: '',
      dados_extraidos: JSON.stringify({
        _override: {
          classificacao: 'tipo_1',
          alvo: 'entrega',
          destino: 'Logística concluída',
          documento: '11143938000187'
        }
      })
    });

    assert.equal(resultado.status, 'concluido');
    assert.equal(chamada[0], 41);
    assert.equal(chamada[1].status_funil, 'entrega');
    assert.match(chamada[1].observacao, /Gmail/);
    assert.equal(chamada[2], null);
    assert.deepEqual(chamada[3], {
      sistema: true,
      origemMovimentacao: 'automacao_gmail',
      automacaoEmailId: 88
    });
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaService.atualizarStatusVenda = atualizarOriginal;
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../src/services/vivo-email-parser.service');
const automacao = require('../src/services/automacao-email.service');

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

test('interpreta problema mesmo com acentos substituidos por caracteres invalidos', () => {
  assert.deepEqual(parser.interpretarEmail(EMAIL_PROBLEMA), {
    documento: '11143938000187', data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99,
    destino: 'Corre��o do Pedido de Venda Pelo Consultor',
    mensagem_operador: '37991490023 - Chama ate cair por VVN, e nao possui WPP.', classificacao: 'tipo_2', alvo: null
  });
});

test('mapeia os destinos de aceite e entrega com texto normal ou corrompido', () => {
  assert.deepEqual(parser.classificarDestino('Aguardando Aceite/Assinatura'), { classificacao: 'tipo_1', alvo: 'aceite_biometria' });
  assert.deepEqual(parser.classificarDestino('Vivocorp - Pedidos > Log�stica Conclu�da'), { classificacao: 'tipo_1', alvo: 'entrega' });
  assert.equal(parser.classificarDestino('Destino novo').classificacao, 'desconhecido');
});

test('valida estritamente data, quantidade, valor e cancelamento', () => {
  const campos = { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 };
  const venda = { data_venda: '2026-08-24', quantidade_linhas: 1, valor_total: 54.99, cancelada_em: null };
  assert.deepEqual(automacao._internals.validarCandidata(venda, campos), []);
  assert.deepEqual(automacao._internals.validarCandidata({ ...venda, data_venda: '2026-08-25' }, campos), ['data da venda divergente']);
  assert.deepEqual(automacao._internals.validarCandidata({ ...venda, quantidade_linhas: 2 }, campos), ['quantidade divergente']);
  assert.deepEqual(automacao._internals.validarCandidata({ ...venda, valor_total: 55 }, campos), ['valor mensal divergente']);
  assert.deepEqual(automacao._internals.validarCandidata({ ...venda, cancelada_em: '2026-08-30' }, campos), ['venda cancelada']);
});

test('normaliza endereco do remetente sem aceitar nome de exibicao', () => {
  assert.equal(automacao._internals.emailRemetente('MS Gestor <workflow@vivo.example>'), 'workflow@vivo.example');
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

const test = require('node:test');
const assert = require('node:assert/strict');
const { simpleParser } = require('mailparser');
const parser = require('../src/services/vivo-email-parser.service');
const automacao = require('../src/services/automacao-email.service');
const FunilEtapa = require('../src/models/FunilEtapa');
const Venda = require('../src/models/Venda');
const AutomacaoEmail = require('../src/models/AutomacaoEmail');
const Usuario = require('../src/models/Usuario');
const VendaProblema = require('../src/models/VendaProblema');
const VendaProblemaEvento = require('../src/models/VendaProblemaEvento');
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

const EMAIL_SUBIR_PEDIDO = `Dados da Venda
ID: 303048
Data da Venda: 27/08/2026 14:30:59
CNPJ: 29.046.034/0001-07 (29046034000107)
Raz�o Social: SINDICATO RURAL DE PIRAI

Resumo da Venda
Total 4 R$ 399,96 R$ 60,00

Workflow (tramita��o do pedido)
Origem: Aguardando Aceite/Assinatura
Mensagem ao Operador: Favor SUBIR PEDIDO agora
Destino: Pend�ncia Pr�-Venda`;

test('interpreta problema mesmo com acentos substituidos por caracteres invalidos', () => {
  assert.deepEqual(parser.interpretarEmail(EMAIL_PROBLEMA), {
    documento: '11143938000187', data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99,
    origem: 'An�lise da Qualidade e Auditoria',
    destino: 'Corre��o do Pedido de Venda Pelo Consultor',
    mensagem_operador: '37991490023 - Chama ate cair por VVN, e nao possui WPP.', classificacao: 'tipo_2', alvo: null
  });
});

test('interpreta input realizado com sucesso e direciona para aceite e biometria', () => {
  assert.deepEqual(parser.interpretarEmail(EMAIL_INPUT_REALIZADO), {
    documento: '29046034000107', data_venda: '2026-08-27', quantidade: 4, valor_mensal: 399.96,
    origem: 'Aguardando Input Autom�tico',
    destino: 'Pend�ncia > Input Realizado com Sucesso',
    mensagem_operador: '1-CG8LB6HL', classificacao: 'tipo_1', alvo: 'apos_aceite_biometria'
  });
});

test('destino prevalece sobre a mensagem subir pedido', () => {
  const interpretado = parser.interpretarEmail(EMAIL_SUBIR_PEDIDO);
  assert.equal(interpretado.mensagem_operador, 'Favor SUBIR PEDIDO agora');
  assert.equal(interpretado.destino, 'Pend�ncia Pr�-Venda');
  assert.equal(interpretado.classificacao, 'desconhecido');
  assert.equal(interpretado.alvo, null);

  const semDestino = parser.interpretarEmail(EMAIL_SUBIR_PEDIDO.replace(/\nDestino:.*$/, ''));
  assert.equal(semDestino.destino, null);
  assert.equal(semDestino.classificacao, 'desconhecido');
  assert.equal(semDestino.alvo, null);

  assert.equal(parser.interpretarEmail(EMAIL_SUBIR_PEDIDO.replace('SUBIR PEDIDO', 'aguardar pedido')).classificacao, 'desconhecido');
});

test('usa o HTML quando a parte de texto do email contem apenas o placeholder', async () => {
  const mime = await simpleParser(Buffer.from(`MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="alternativa"

--alternativa
Content-Type: text/plain; charset=utf-8

This is the plain text version of the email content
--alternativa
Content-Type: text/html; charset=utf-8

<html><body>
  <h3>Dados da Venda</h3>
  <div>ID: 303048</div>
  <div>Tipo Pessoa: Pessoa Jur&iacute;dica</div>
  <div>Data da Venda: 27/08/2026 14:30:59</div>
  <div>CNPJ: 29.046.034/0001-07 (29046034000107)</div>
  <div>Raz&atilde;o Social: SINDICATO RURAL DE PIRAI</div>
  <div>Nome Comercial:</div>
  <h3>Resumo da Venda</h3>
  <table><tr><th>Indicador</th><th>Quantidade</th><th>Total Mensal</th><th>Total Aparelho</th></tr>
  <tr><td>Alta - Terminais</td><td>4</td><td>R$ 399,96</td><td>R$ 60,00</td></tr>
  <tr><td>Total</td><td>4</td><td>R$ 399,96</td><td>R$ 60,00</td></tr></table>
  <h3>Workflow (tramita&ccedil;&atilde;o do pedido)</h3>
  <div>Origem: Aguardando Input Autom&aacute;tico</div>
  <div>Mensagem ao Operador: 1-CG8LB6HL</div>
  <div>Destino: Pend&ecirc;ncia &gt; Input Realizado com Sucesso</div>
</body></html>
--alternativa--`));

  assert.equal(mime.text.trim(), 'This is the plain text version of the email content');
  assert.deepEqual(parser.interpretarEmail(automacao._internals.extrairCorpoMensagem(mime)), {
    documento: '29046034000107', data_venda: '2026-08-27', quantidade: 4, valor_mensal: 399.96,
    origem: 'Aguardando Input Automático',
    destino: 'Pendência > Input Realizado com Sucesso',
    mensagem_operador: '1-CG8LB6HL', classificacao: 'tipo_1', alvo: 'apos_aceite_biometria'
  });
});

test('repeticao recarrega do Gmail um corpo armazenado sem dados uteis', async () => {
  let mensagemConsultada = null;
  const atualizacao = await automacao._internals.prepararRepeticao({
    gmail_message_id: 'gmail-303048',
    corpo_texto: 'This is the plain text version of the email content'
  }, async gmailMessageId => {
    mensagemConsultada = gmailMessageId;
    return EMAIL_INPUT_REALIZADO;
  });

  assert.equal(mensagemConsultada, 'gmail-303048');
  assert.equal(atualizacao.status, 'pendente');
  assert.equal(atualizacao.erro, null);
  assert.equal(atualizacao.corpo_texto, EMAIL_INPUT_REALIZADO);
  assert.match(atualizacao.corpo_hash, /^[a-f0-9]{64}$/);
});

test('mapeia os destinos de aceite e entrega com texto normal ou corrompido', () => {
  assert.deepEqual(parser.classificarDestino('Aguardando Aceite/Assinatura'), { classificacao: 'tipo_1', alvo: 'aceite_biometria' });
  assert.deepEqual(parser.classificarDestino('Vivocorp - Pedidos > Log�stica Conclu�da'), { classificacao: 'tipo_1', alvo: 'etapa_final' });
  assert.equal(parser.classificarDestino('Destino novo').classificacao, 'desconhecido');
});

test('classifica os exemplos de workflow pelo destino e preserva a origem para auditoria', () => {
  const exemplos = [
    ['Correção do Pedido de Venda Pelo Consultor', 'retornar', 'Antifraude - Processo Em Revisão Crítica (Qualidade e Auditoria)', 'sem_acao', 'sem_acao'],
    ['Correção do Pedido de Venda Pelo Consultor', 'retornar', 'Análise Ilha de Auditoria', 'sem_acao', 'sem_acao'],
    ['Análise da Qualidade e Auditoria', 'CONFIRMADO COM BRUNA NO Nº 35991294304 (WhatsApp)', 'Análise da Ilha de Input', 'sem_acao', 'sem_acao'],
    ['Análise da Qualidade e Auditoria', 'retornar as 11:00', 'Aguardando Tratativas da Auditoria', 'sem_acao', 'sem_acao'],
    ['Correção do Pedido de Venda Pelo Consultor', 'o ddd de contato é 24', 'Antifraude - Processo Em Revisão Crítica (Qualidade e Auditoria)', 'sem_acao', 'sem_acao'],
    ['Vivocorp - Pedidos > Backoffice Aprovado', 'Processo de importação manual por Arquivo InfoB2B', 'Vivocorp - Pedidos > Logística Concluída', 'tipo_1', 'etapa_final'],
    ['Suporte Pré-Venda', 'Nº da Simulação S000007186870', 'Aguardando Aceite/Assinatura', 'tipo_1', 'aceite_biometria'],
    ['Correção do Pedido de Venda Pelo Consultor', '', 'Suporte Pré-Venda', 'tipo_1', 'aceite_biometria'],
    ['Análise da Ilha de Input', 'Número da Simulação -->> S000007139006', 'Aguardando Input Automático', 'tipo_1', 'apos_aceite_biometria'],
    ['Correção do Pedido de Venda Pelo Consultor', 'quem sobe TERMO não somos e o suporte deve verificar', 'Antifraude - Processo Em Revisão Crítica (Qualidade e Auditoria)', 'sem_acao', 'sem_acao'],
    ['Aguardando Input Automático', '1-CG5PVC1B', 'Pendência > Input Realizado com Sucesso', 'tipo_1', 'apos_aceite_biometria'],
    ['Inserção do Nº da Cotação Vivocorp', '1-975211614097', 'Vivocorp - Pedidos > Logística Concluída', 'tipo_1', 'etapa_final'],
    ['Aguardando Aceite/Assinatura', 'Bom dia, favor verificar se o cliente ainda tem interesse no pedido.', 'Correção do Pedido de Venda Pelo Consultor', 'tipo_2', null]
  ];

  for (const [origem, mensagem, destino, classificacao, alvo] of exemplos) {
    const resultado = parser.interpretarEmail(`Workflow (tramitação do pedido)\nOrigem: ${origem}\nMensagem ao Operador: ${mensagem}\nDestino: ${destino}`);
    assert.equal(resultado.origem, origem);
    assert.equal(resultado.destino, destino);
    assert.equal(resultado.classificacao, classificacao, destino);
    assert.equal(resultado.alvo, alvo, destino);
  }
});

test('seleciona a primeira etapa ativa depois de aceite e biometria', async () => {
  const queryOriginal = FunilEtapa.query;
  const etapas = [
    { codigo: 'analise', nome: 'Análise', ordem: 1, ativo: true, aceite_biometria: false },
    { codigo: 'aceite', nome: 'Aceite', ordem: 2, ativo: true, aceite_biometria: true },
    { codigo: 'ignorada', nome: 'Ignorada', ordem: 3, ativo: false, aceite_biometria: false },
    { codigo: 'pos_aceite', nome: 'Pós-aceite', ordem: 4, ativo: true, aceite_biometria: false }
  ];
  FunilEtapa.query = () => ({
    where(filtros) {
      assert.deepEqual(filtros, { ativo: true });
      return this;
    },
    orderBy() { return this; },
    then(resolve) { return Promise.resolve(etapas.filter(etapa => etapa.ativo)).then(resolve); }
  });

  try {
    const resultado = await automacao._internals.resolverEtapaDestino('apos_aceite_biometria');
    assert.equal(resultado.etapa.codigo, 'pos_aceite');
    assert.equal(resultado.erro, null);
  } finally {
    FunilEtapa.query = queryOriginal;
  }
});

test('explica configuracao invalida para o avanco depois do aceite', async () => {
  const queryOriginal = FunilEtapa.query;
  let etapas = [];
  FunilEtapa.query = () => ({
    where() { return this; },
    orderBy() { return this; },
    then(resolve) { return Promise.resolve(etapas).then(resolve); }
  });

  try {
    let resultado = await automacao._internals.resolverEtapaDestino('apos_aceite_biometria');
    assert.match(resultado.erro, /uma única etapa ativa.*Aceite\/Biometria/);

    etapas = [
      { codigo: 'aceite_a', ordem: 1, aceite_biometria: true },
      { codigo: 'aceite_b', ordem: 2, aceite_biometria: true }
    ];
    resultado = await automacao._internals.resolverEtapaDestino('apos_aceite_biometria');
    assert.match(resultado.erro, /uma única etapa ativa.*Aceite\/Biometria/);

    etapas = [{ codigo: 'aceite', ordem: 2, aceite_biometria: true }];
    resultado = await automacao._internals.resolverEtapaDestino('apos_aceite_biometria');
    assert.match(resultado.erro, /Não há etapa ativa após Aceite\/Biometria/);
  } finally {
    FunilEtapa.query = queryOriginal;
  }
});

test('resolve somente uma etapa final ativa configurada', async () => {
  const queryOriginal = FunilEtapa.query;
  let etapas = [{ codigo: 'final_personalizado', etapa_final: true, ativo: true }];
  FunilEtapa.query = () => ({ where: async filtros => {
    assert.deepEqual(filtros, { ativo: true, etapa_final: true });
    return etapas;
  } });

  try {
    let resultado = await automacao._internals.resolverEtapaDestino('etapa_final');
    assert.equal(resultado.etapa.codigo, 'final_personalizado');
    assert.equal(resultado.erro, null);

    etapas = [];
    resultado = await automacao._internals.resolverEtapaDestino('etapa_final');
    assert.equal(resultado.etapa, null);
    assert.match(resultado.erro, /uma única etapa final ativa/);

    etapas = [{ codigo: 'final_a' }, { codigo: 'final_b' }];
    resultado = await automacao._internals.resolverEtapaDestino('etapa_final');
    assert.equal(resultado.etapa, null);
    assert.match(resultado.erro, /uma única etapa final ativa/);
  } finally {
    FunilEtapa.query = queryOriginal;
  }
});

test('resolve a etapa de confirmacao de SMS por nome normalizado e exige unicidade', async () => {
  const queryOriginal = FunilEtapa.query;
  let etapas = [{ codigo: 'sms_portabilidade', nome: 'Confirmação SMS Portabilidade', ativo: true }];
  FunilEtapa.query = () => ({ where: async filtros => {
    assert.deepEqual(filtros, { ativo: true });
    return etapas;
  } });

  try {
    let resultado = await automacao._internals.resolverEtapaDestino('confirmacao_sms_portabilidade');
    assert.equal(resultado.etapa.codigo, 'sms_portabilidade');
    assert.equal(resultado.erro, null);

    etapas = [{ codigo: 'outra', nome: 'Outra etapa', ativo: true }];
    resultado = await automacao._internals.resolverEtapaDestino('confirmacao_sms_portabilidade');
    assert.equal(resultado.etapa, null);
    assert.match(resultado.erro, /Confirmação SMS Portabilidade/);

    etapas = [
      { codigo: 'sms_a', nome: 'Confirmação SMS Portabilidade', ativo: true },
      { codigo: 'sms_b', nome: 'Confirmacao SMS Portabilidade', ativo: true }
    ];
    resultado = await automacao._internals.resolverEtapaDestino('confirmacao_sms_portabilidade');
    assert.equal(resultado.etapa, null);
    assert.match(resultado.erro, /uma única etapa ativa/);
  } finally {
    FunilEtapa.query = queryOriginal;
  }
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

test('valida os filtros e tamanhos permitidos da pagina de problemas', () => {
  assert.equal(automacao._internals.filtroProblemas(), 'abertos');
  assert.equal(automacao._internals.filtroProblemas('resolvidos'), 'resolvidos');
  assert.throws(() => automacao._internals.filtroProblemas('qualquer'), /Status de problemas inválido/);
  assert.equal(automacao._internals.porPaginaProblemas(50), 50);
  assert.equal(automacao._internals.porPaginaProblemas(999), 20);
});

test('pagina automacoes por status com ordenacao deterministica', async () => {
  const queryOriginal = AutomacaoEmail.query;
  const chamadas = [];
  class QueryAutomacao {
    orderBy(campo, direcao) { chamadas.push(['orderBy', campo, direcao]); return this; }
    where(campo, valor) { chamadas.push(['where', campo, valor]); return this; }
    async page(offset, limite) {
      chamadas.push(['page', offset, limite]);
      return { total: 121, results: [{ id: 7, dados_extraidos: '{"destino":"Entrega"}' }] };
    }
  }
  AutomacaoEmail.query = () => new QueryAutomacao();
  try {
    const resultado = await automacao.listar({ status: 'revisao', page: 2, per_page: 100 });
    assert.deepEqual(chamadas, [
      ['orderBy', 'recebido_em', 'desc'],
      ['orderBy', 'id', 'desc'],
      ['where', 'status', 'revisao'],
      ['page', 1, 100]
    ]);
    assert.equal(resultado.total, 121);
    assert.equal(resultado.page, 2);
    assert.equal(resultado.per_page, 100);
    assert.deepEqual(resultado.data[0].dados_extraidos, { destino: 'Entrega' });
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
});

test('pagina problemas resolvidos e monta auditoria com eventos buscados em lote', async () => {
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  const queryEventoOriginal = VendaProblemaEvento.query;
  const queryVendaOriginal = Venda.query;
  let consulta = 0;
  const metodosFluentes = ['alias', 'join', 'where', 'whereIn', 'select', 'orderBy', 'count', 'withGraphFetched', 'modifyGraph'];

  class QueryAutomacao {
    constructor(indice) { this.indice = indice; }
    async page(offset, limite) {
      assert.equal(offset, 1);
      assert.equal(limite, 50);
      return {
        total: 51,
        results: [{
          id: 30, problema_id: 9, venda_id: 55, problema_status: 'verificado',
          resolvido_em: '2026-08-31 15:30:00', resolvido_por_id: 4, resolvido_por_nome: 'Maria Silva',
          dados_extraidos: JSON.stringify({ mensagem_operador: 'Ajustar cadastro.' })
        }]
      };
    }
    async first() { return { total: this.indice === 1 ? 2 : 51 }; }
  }
  metodosFluentes.forEach(metodo => { QueryAutomacao.prototype[metodo] = function () { return this; }; });

  const eventos = [{
    id: 70, problema_id: 9, tipo: 'resolucao_automatica', mensagem: 'Cadastro atualizado.',
    created_at: '2026-08-31 15:30:00', usuario: { id: 4, nome: 'Maria Silva' }
  }];
  class QueryEvento {
    whereIn() { return this; }
    withGraphFetched() { return this; }
    modifyGraph() { return this; }
    orderBy() { return this; }
    then(resolve) { return Promise.resolve(eventos).then(resolve); }
  }

  class QueryVenda {
    whereIn() { return this; }
    select() { return this; }
    withGraphFetched() { return this; }
    modifyGraph() { return this; }
    then(resolve) {
      return Promise.resolve([{
        id: 55,
        data_venda: '2026-08-20',
        created_at: '2026-08-19 10:00:00',
        valores_unitarios_chips: JSON.stringify([{ quantidade: 2, gb: '30', tipo_linha: 'novo', vendedora_id: 4, operadora_id: 2, valor_unitario: 59.9 }]),
        vendedora: { id: 4, nome: 'Maria Silva' },
        vendedoras: [{ id: 4, nome: 'Maria Silva' }],
        operadora: { id: 2, nome: 'VIVO' },
        operadoraAtual: null
      }]).then(resolve);
    }
  }

  AutomacaoEmail.query = () => new QueryAutomacao(consulta++);
  VendaProblemaEvento.query = () => new QueryEvento();
  Venda.query = () => new QueryVenda();
  try {
    const resultado = await automacao.listarProblemas({ status: 'resolvidos', page: 2, per_page: 50 });
    assert.equal(resultado.total, 51);
    assert.deepEqual(resultado.totals, { abertos: 2, resolvidos: 51 });
    assert.equal(resultado.data[0].dados_extraidos.mensagem_operador, 'Ajustar cadastro.');
    assert.equal(resultado.data[0].resolucao.usuario.nome, 'Maria Silva');
    assert.equal(resultado.data[0].resolucao.mensagem, 'Cadastro atualizado.');
    assert.equal(resultado.data[0].venda_resumo.vendedoras[0].nome, 'Maria Silva');
    assert.equal(resultado.data[0].venda_resumo.chips[0].operadora_destino, 'VIVO');
    assert.equal(resultado.data[0].venda_resumo.chips[0].subtotal, 119.8);
    assert.equal(consulta, 3);
  } finally {
    AutomacaoEmail.query = queryAutomacaoOriginal;
    VendaProblemaEvento.query = queryEventoOriginal;
    Venda.query = queryVendaOriginal;
  }
});

test('impede resolver novamente um problema automático já verificado', async () => {
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  const queryProblemaOriginal = VendaProblema.query;
  const transactionOriginal = VendaProblema.transaction;
  const queryUsuarioOriginal = Usuario.query;
  AutomacaoEmail.query = () => ({ findOne: async () => ({ id: 8, problema_id: 7 }) });
  VendaProblema.query = () => ({ findById() { return this; }, forUpdate: async () => ({ id: 7, status: 'verificado' }) });
  VendaProblema.transaction = async callback => callback({});
  Usuario.query = () => { throw new Error('Não deveria consultar o usuário.'); };
  try {
    await assert.rejects(
      automacao.resolverProblemaAutomatico(7, 'Tentativa duplicada.', 4),
      error => error.statusCode === 409 && /já foi resolvido/.test(error.message)
    );
  } finally {
    AutomacaoEmail.query = queryAutomacaoOriginal;
    VendaProblema.query = queryProblemaOriginal;
    VendaProblema.transaction = transactionOriginal;
    Usuario.query = queryUsuarioOriginal;
  }
});

test('carrega a venda completa somente a partir do vínculo do problema automático', async () => {
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  const buscarVendaOriginal = vendaService.buscarVendaPorId;
  let vendaConsultada = null;
  AutomacaoEmail.query = () => ({ findOne: async () => ({ problema_id: 7, venda_id: 42 }) });
  vendaService.buscarVendaPorId = async id => { vendaConsultada = id; return { id, nome: 'Venda completa' }; };
  try {
    const venda = await automacao.obterVendaProblemaAutomatico(7);
    assert.equal(vendaConsultada, 42);
    assert.equal(venda.nome, 'Venda completa');
  } finally {
    AutomacaoEmail.query = queryAutomacaoOriginal;
    vendaService.buscarVendaPorId = buscarVendaOriginal;
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

test('destino neutro conclui sem mover a venda nem abrir problema', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaService.atualizarStatusVenda;
  let tentouMover = false;

  Venda.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({ id: 41, status_funil: 'ativacao', excluido_em: null, cancelada_em: null })
  });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'concluido' }] });
  vendaService.atualizarStatusVenda = async () => { tentouMover = true; return { status: 'ok' }; };

  try {
    const resultado = await automacao._internals.processarRegistro({
      id: 90,
      venda_id: 41,
      revisado_por_id: 7,
      corpo_texto: '',
      dados_extraidos: JSON.stringify({
        _override: {
          classificacao: 'sem_acao',
          alvo: 'sem_acao',
          destino: 'Antifraude - Processo Em Revisão Crítica',
          documento: '11143938000187'
        }
      })
    });

    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.classificacao, 'sem_acao');
    assert.equal(resultado.venda_id, 41);
    assert.equal(resultado.etapa_destino, null);
    assert.equal(resultado.problema_id, undefined);
    assert.equal(tentouMover, false);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaService.atualizarStatusVenda = atualizarOriginal;
  }
});

test('logistica concluida finaliza venda nova e envia portabilidade para confirmacao de SMS', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaService.atualizarStatusVenda;
  const etapaFinal = { codigo: 'final_personalizado', ordem: 5, ativo: true, etapa_final: true };
  const etapaSms = { codigo: 'sms_portabilidade', nome: 'Confirmação SMS Portabilidade', ordem: 4, ativo: true };
  let vendaAtual;
  const movimentos = [];

  Venda.query = () => ({
    porId: false,
    findById() { this.porId = true; return this; },
    alias() { return this; },
    leftJoinRelated() { return this; },
    select() { return this; },
    where() { return this; },
    whereNull() { return this; },
    withGraphFetched() { return Promise.resolve(this.porId ? vendaAtual : [vendaAtual]); }
  });
  FunilEtapa.query = () => ({
    where: async filtros => filtros?.etapa_final ? [etapaFinal] : [etapaSms, etapaFinal],
    findOne: async filtros => [etapaFinal, etapaSms].find(etapa => etapa.codigo === filtros.codigo) || { codigo: 'ativacao', ordem: 2 }
  });
  vendaService.atualizarStatusVenda = async (...args) => { movimentos.push(args); return { status: 'ok' }; };

  const corpo = () => `Dados da Venda\nCNPJ: 11.143.938/0001-87\nWorkflow (tramitação do pedido)\nOrigem: Backoffice Aprovado\nMensagem ao Operador: importação manual\nDestino: Vivocorp - Pedidos > Logística Concluída`;
  const registroAutomatico = () => ({ id: 91, corpo_texto: corpo(), dados_extraidos: null });

  try {
    vendaAtual = {
      id: 41, status_funil: 'ativacao', excluido_em: null, cancelada_em: null,
      cnpj: '11.143.938/0001-87', valores_unitarios_chips: JSON.stringify([{ quantidade: 1, tipo_linha: 'novo' }]), numeros_portados: null
    };
    let resultado = await automacao._internals.processarRegistro(registroAutomatico());
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.etapa_destino, etapaFinal.codigo);
    assert.equal(movimentos.at(-1)[1].status_funil, etapaFinal.codigo);

    vendaAtual = {
      ...vendaAtual,
      valores_unitarios_chips: JSON.stringify([{ quantidade: 1, tipo_linha: 'portabilidade' }]),
      numeros_portados: null
    };
    const movimentosAntes = movimentos.length;
    resultado = await automacao._internals.processarRegistro(registroAutomatico());
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.etapa_destino, etapaSms.codigo);
    assert.equal(movimentos.length, movimentosAntes + 1);
    assert.equal(movimentos.at(-1)[1].status_funil, etapaSms.codigo);

    assert.equal(automacao._internals.vendaTemPortabilidade({ valores_unitarios_chips: '[]', numeros_portados: '24999999999' }), true);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaService.atualizarStatusVenda = atualizarOriginal;
  }
});

test('pedido na operadora avanca apos aceite sem repetir movimento nem regredir o funil', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaService.atualizarStatusVenda;
  const etapas = [
    { codigo: 'analise', nome: 'Análise', ordem: 1, ativo: true, aceite_biometria: false },
    { codigo: 'aceite', nome: 'Aceite', ordem: 2, ativo: true, aceite_biometria: true },
    { codigo: 'pos_aceite', nome: 'Pós-aceite', ordem: 3, ativo: true, aceite_biometria: false },
    { codigo: 'entrega', nome: 'Entrega', ordem: 4, ativo: true, aceite_biometria: false }
  ];
  let statusAtual = 'aceite';
  let movimentos = [];

  Venda.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({
      id: 41,
      status_funil: statusAtual,
      excluido_em: null,
      cancelada_em: null
    })
  });
  FunilEtapa.query = () => ({
    where(filtros) {
      if (filtros?.etapa_final) return Promise.resolve([{ codigo: 'final' }]);
      this.filtros = filtros;
      return this;
    },
    orderBy() { return this; },
    then(resolve) {
      return Promise.resolve(etapas.filter(etapa => etapa.ativo)).then(resolve);
    },
    findOne: async filtros => etapas.find(etapa => etapa.codigo === filtros.codigo) || null
  });
  vendaService.atualizarStatusVenda = async (...args) => {
    movimentos.push(args);
    return { status: 'ok' };
  };

  const registro = () => ({
    id: 88,
    venda_id: 41,
    revisado_por_id: 7,
    corpo_texto: '',
    dados_extraidos: JSON.stringify({
      _override: {
        classificacao: 'tipo_1',
        alvo: 'apos_aceite_biometria',
        destino: 'Pendência Pré-Venda',
        mensagem_operador: 'subir pedido',
        documento: '29046034000107'
      }
    })
  });

  try {
    let resultado = await automacao._internals.processarRegistro(registro());
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.etapa_destino, 'pos_aceite');
    assert.equal(movimentos.length, 1);
    assert.equal(movimentos[0][1].status_funil, 'pos_aceite');
    assert.deepEqual(movimentos[0][3], {
      sistema: true,
      origemMovimentacao: 'automacao_gmail',
      automacaoEmailId: 88
    });

    statusAtual = 'pos_aceite';
    movimentos = [];
    resultado = await automacao._internals.processarRegistro(registro());
    assert.equal(resultado.status, 'concluido');
    assert.equal(movimentos.length, 0);

    statusAtual = 'entrega';
    resultado = await automacao._internals.processarRegistro(registro());
    assert.equal(resultado.status, 'revisao');
    assert.match(resultado.erro, /regredir o funil/);
    assert.equal(movimentos.length, 0);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaService.atualizarStatusVenda = atualizarOriginal;
  }
});

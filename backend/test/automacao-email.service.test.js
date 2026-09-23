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
const VendaHistorico = require('../src/models/VendaHistorico');
const vendaService = require('../src/services/venda.service');
const vendaFunilAutomacaoService = require('../src/services/venda-funil-automacao.service');
const VendaFunilAutomacao = require('../src/models/VendaFunilAutomacao');
const vendaNotificacaoCancelamentoService = require('../src/services/venda-notificacao-cancelamento.service');
const automacaoController = require('../src/controllers/automacao.controller');
const automacaoRoutes = require('../src/routes/automacao.routes');

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

const EMAIL_CANCELAMENTO = `Dados da Venda
CNPJ: 11.143.938/0001-87 (11143938000187)
Workflow (tramita��o do pedido)
Origem: Corre��o do Pedido de Venda Pelo Consultor
Mensagem ao Operador: cancelar
Destino: Pedido Cancelado pelo Consultor`;

const EMAIL_CANCELAMENTO_CLIENTE = `Dados da Venda
Data da Venda: 03/08/2026 15:01:48
CNPJ: 07.979.890/0001-74 (07979890000174)
Raz�o Social: ATUAL SERVICOS CONTABEIS LTDA
Nome Comercial:

Resumo da Venda
Indicador Quantidade Total Mensal Total Aparelho Total 2 R$ 109,98 R$ 30,00 Alta - Portabilidade 2 R$ 109,98 R$ 30,00

Workflow (tramita��o do pedido)
Origem: Corre��o do Pedido de Venda Pelo Consultor
Mensagem ao Operador: cliente desistiu
Destino: Pedido Cancelado pelo Cliente`;

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
  assert.equal(interpretado.classificacao, 'tipo_1');
  assert.equal(interpretado.alvo, 'aceite_biometria');

  const semDestino = parser.interpretarEmail(EMAIL_SUBIR_PEDIDO.replace(/\nDestino:.*$/, ''));
  assert.equal(semDestino.destino, null);
  assert.equal(semDestino.classificacao, 'desconhecido');
  assert.equal(semDestino.alvo, null);

  assert.equal(parser.interpretarEmail(EMAIL_SUBIR_PEDIDO.replace('SUBIR PEDIDO', 'aguardar pedido')).classificacao, 'tipo_1');
});

test('classifica cancelamento pelo destino com texto corrompido e ignora origem e mensagem', () => {
  const interpretado = parser.interpretarEmail(EMAIL_CANCELAMENTO);
  assert.equal(interpretado.documento, '11143938000187');
  assert.equal(interpretado.origem, 'Corre��o do Pedido de Venda Pelo Consultor');
  assert.equal(interpretado.destino, 'Pedido Cancelado pelo Consultor');
  assert.equal(interpretado.mensagem_operador, 'cancelar');
  assert.equal(interpretado.classificacao, 'cancelamento');
  assert.equal(interpretado.alvo, 'cancelar_venda');

  const diferente = EMAIL_CANCELAMENTO
    .replace('Corre��o do Pedido de Venda Pelo Consultor', 'Análise da Qualidade')
    .replace('Mensagem ao Operador: cancelar', 'Mensagem ao Operador: conferir novamente');
  assert.equal(parser.interpretarEmail(diferente).classificacao, 'cancelamento');
  assert.deepEqual(parser.classificarDestino('Pedido Cancelado pelo Consultor'), {
    classificacao: 'cancelamento', alvo: 'cancelar_venda'
  });

  const canceladoPeloCliente = parser.interpretarEmail(EMAIL_CANCELAMENTO_CLIENTE);
  assert.equal(canceladoPeloCliente.documento, '07979890000174');
  assert.equal(canceladoPeloCliente.origem, 'Corre��o do Pedido de Venda Pelo Consultor');
  assert.equal(canceladoPeloCliente.mensagem_operador, 'cliente desistiu');
  assert.equal(canceladoPeloCliente.destino, 'Pedido Cancelado pelo Cliente');
  assert.equal(canceladoPeloCliente.classificacao, 'cancelamento');
  assert.equal(canceladoPeloCliente.alvo, 'cancelar_venda');
  assert.deepEqual(parser.classificarDestino('Pedido Cancelado pelo Cliente'), {
    classificacao: 'cancelamento', alvo: 'cancelar_venda'
  });
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

test('repete uma fotografia das revisoes, preserva overrides e isola falhas de preparacao', async () => {
  const queryAutomacaoOriginal = AutomacaoEmail.query;
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
  const override = {
    classificacao: 'sem_acao', alvo: 'sem_acao', destino: 'Antifraude - Processo Em Revisão Crítica', documento: '11143938000187'
  };
  const registros = [
    { id: 1, status: 'revisao', recebido_em: '2026-09-01 10:00:00', tentativas: 2, venda_id: 41, revisado_por_id: 7, corpo_texto: '', dados_extraidos: JSON.stringify({ _override: override }) },
    { id: 2, status: 'regressao_funil', recebido_em: '2026-09-01 11:00:00', tentativas: 1, gmail_message_id: 'gmail-falha', corpo_texto: 'This is the plain text version of the email content', dados_extraidos: '{}' }
  ];

  class QueryAutomacao {
    constructor() { this.filtros = {}; }
    where(campo, valor) {
      if (typeof campo === 'object') Object.assign(this.filtros, campo);
      else this.filtros[campo] = valor;
      return this;
    }
    whereIn(campo, valores) { this.filtros[campo] = valores; return this; }
    orderBy() { return this; }
    linhas() { return registros.filter(item => Object.entries(this.filtros).every(([campo, valor]) => Array.isArray(valor) ? valor.includes(item[campo]) : item[campo] === valor)); }
    then(resolve, reject) { return Promise.resolve(this.linhas().map(item => ({ ...item }))).then(resolve, reject); }
    async patch(dados) {
      const linhas = this.linhas();
      linhas.forEach(item => Object.assign(item, dados));
      return linhas.length;
    }
    async patchAndFetchById(id, dados) {
      const item = registros.find(registro => registro.id === id);
      if (item) Object.assign(item, dados);
      return item || null;
    }
  }

  AutomacaoEmail.query = () => new QueryAutomacao();
  Venda.query = () => ({ findById() { return this; }, withGraphFetched: async () => ({ id: 41, status_funil: 'ativacao', excluido_em: null, cancelada_em: null }) });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'concluido' }] });
  VendaFunilAutomacao.query = () => ({ findById: async () => null });

  try {
    const resultado = await automacao.repetirRevisoes(async gmailId => {
      assert.equal(gmailId, 'gmail-falha');
      throw new Error('Gmail indisponível');
    });
    assert.deepEqual(resultado, { selecionados: 2, repetidos: 1, falhas: 1 });
    assert.equal(registros[0].status, 'concluido');
    assert.equal(registros[0].tentativas, 3);
    assert.deepEqual(JSON.parse(registros[0].dados_extraidos)._override, override);
    assert.equal(registros[1].status, 'regressao_funil');
    assert.match(registros[1].erro, /Falha ao preparar repetição: Gmail indisponível/);

    registros.length = 0;
    assert.deepEqual(await automacao.repetirRevisoes(), { selecionados: 0, repetidos: 0, falhas: 0 });
  } finally {
    AutomacaoEmail.query = queryAutomacaoOriginal;
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

test('claim concorrente impede processar novamente o mesmo pendente', async () => {
  const queryOriginal = AutomacaoEmail.query;
  let patchesFinais = 0;
  AutomacaoEmail.query = () => ({
    where() { return this; },
    patch: async () => 0,
    patchAndFetchById: async () => { patchesFinais += 1; }
  });
  try {
    assert.equal(await automacao._internals.processarPendente({ id: 8, status: 'pendente', tentativas: 3 }), false);
    assert.equal(patchesFinais, 0);
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
});

test('claim de nova tentativa limpa classificacao anterior antes do processamento', async () => {
  const queryOriginal = AutomacaoEmail.query;
  let dadosClaim = null;
  AutomacaoEmail.query = () => ({
    where() { return this; },
    async patch(dados) { dadosClaim = dados; return 0; }
  });
  try {
    await automacao._internals.processarPendente({ id: 9, status: 'pendente', tentativas: 1, classificacao: 'cancelamento' });
    assert.equal(dadosClaim.status, 'processando');
    assert.equal(dadosClaim.classificacao, null);
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
});

test('endpoint em lote precede as rotas parametrizadas e repassa o contrato do servico', async () => {
  const camadas = automacaoRoutes.stack;
  const indicePermissao = camadas.findIndex(camada => camada.name === 'permissaoMiddleware');
  const indiceLote = camadas.findIndex(camada => camada.route?.path === '/repetir-revisoes');
  const indiceIndividual = camadas.findIndex(camada => camada.route?.path === '/:id/repetir');
  assert.ok(indicePermissao >= 0 && indicePermissao < indiceLote);
  assert.ok(indiceLote >= 0 && indiceLote < indiceIndividual);

  const repetirOriginal = automacao.repetirRevisoes;
  automacao.repetirRevisoes = async () => ({ selecionados: 4, repetidos: 3, falhas: 1 });
  const res = { body: null, json(dados) { this.body = dados; return this; } };
  try {
    await automacaoController.repetirRevisoes({}, res);
    assert.deepEqual(res.body, { selecionados: 4, repetidos: 3, falhas: 1 });
  } finally {
    automacao.repetirRevisoes = repetirOriginal;
  }
});

test('diagnóstico IMAP fica protegido e repassa o resultado do runtime', async () => {
  const camadas = automacaoRoutes.stack;
  const indicePermissao = camadas.findIndex(camada => camada.name === 'permissaoMiddleware');
  const camadaDiagnostico = camadas.find(camada => camada.route?.path === '/diagnostico-imap');
  assert.ok(indicePermissao >= 0);
  assert.ok(camadaDiagnostico);
  assert.ok(camadas.indexOf(camadaDiagnostico) > indicePermissao);
  assert.equal(camadaDiagnostico.route.methods.post, true);

  const diagnosticarOriginal = automacao.diagnosticarImap;
  automacao.diagnosticarImap = async () => ({ imap: { ok: true }, ip_saida_https: { ok: true, ip: '203.0.113.10' } });
  const res = { body: null, json(dados) { this.body = dados; return this; } };
  try {
    await automacaoController.diagnosticarImap({}, res);
    assert.deepEqual(res.body, { imap: { ok: true }, ip_saida_https: { ok: true, ip: '203.0.113.10' } });
  } finally {
    automacao.diagnosticarImap = diagnosticarOriginal;
  }
});

test('endpoint de candidatas fica protegido e repassa execucao e CNPJ ao servico', async () => {
  const camadas = automacaoRoutes.stack;
  const indicePermissao = camadas.findIndex(camada => camada.name === 'permissaoMiddleware');
  const camadaCandidatas = camadas.find(camada => camada.route?.path === '/:id/vendas-candidatas');
  assert.ok(indicePermissao >= 0);
  assert.ok(camadaCandidatas);
  assert.ok(camadas.indexOf(camadaCandidatas) > indicePermissao);
  assert.equal(camadaCandidatas.route.methods.get, true);

  const listarOriginal = automacao.listarVendasCandidatas;
  automacao.listarVendasCandidatas = async (id, cnpj) => ({ automacao_id: Number(id), cnpj, vendas: [] });
  const res = { body: null, json(dados) { this.body = dados; return this; } };
  try {
    await automacaoController.vendasCandidatas({ params: { id: '10' }, query: { cnpj: '11143938000187' } }, res);
    assert.deepEqual(res.body, { automacao_id: 10, cnpj: '11143938000187', vendas: [] });
  } finally {
    automacao.listarVendasCandidatas = listarOriginal;
  }
});

test('consulta de candidatas valida execução e CNPJ antes de avaliar vendas atuais', async () => {
  const queryOriginal = AutomacaoEmail.query;
  const registro = {
    id: 10,
    classificacao: 'tipo_1',
    dados_extraidos: JSON.stringify({ documento: '11143938000187', quantidade: 2 })
  };
  try {
    AutomacaoEmail.query = () => ({ findById: async id => (Number(id) === 10 ? registro : null) });
    assert.equal(await automacao.listarVendasCandidatas(99), null);
    await assert.rejects(
      automacao.listarVendasCandidatas(10, '123'),
      error => error.statusCode === 422 && /14 digitos/.test(error.message)
    );

    const resultado = await automacao.listarVendasCandidatas(10, '17025544000704', {
      buscar: async campos => [
        {
          id: 51,
          nome: 'Empresa atual',
          razao_social: 'Empresa Atual LTDA',
          status_funil: 'entrega',
          data_venda: '2026-08-25',
          quantidade_linhas: 2,
          valor_total: 100,
          valores_unitarios_chips: JSON.stringify([{ quantidade: 2, tipo_linha: 'novo', valor_unitario: 50 }])
        },
        {
          id: 52,
          status_funil: 'entrega',
          valores_unitarios_chips: [
            { quantidade: 1, tipo_linha: 'novo', valor_unitario: 49.9 },
            { quantidade: 2, tipo_linha: 'portabilidade', valor_unitario: '59,90' }
          ]
        },
        { id: 53, status_funil: 'entrega', valores_unitarios_chips: '3 x 39,90' },
        { id: 54, status_funil: 'entrega', tipoVenda: { nome: 'Portabilidade' }, valores_unitarios_chips: null }
      ],
      etapasFinais: async () => ['concluido']
    });

    assert.equal(resultado.cnpj, '17025544000704');
    assert.equal(resultado.cnpj_original, '11143938000187');
    assert.equal(resultado.vendas[0].razao_social, 'Empresa Atual LTDA');
    assert.equal(resultado.vendas[0].elegivel, true);
    assert.equal(resultado.vendas[0].tipo_venda, 'Novo');
    assert.deepEqual(resultado.vendas[0].chips, [{ quantidade: 2, tipo_linha: 'novo', valor_unitario: 50 }]);
    assert.equal(resultado.vendas[1].tipo_venda, 'Novo e Portabilidade');
    assert.deepEqual(resultado.vendas[1].chips, [
      { quantidade: 1, tipo_linha: 'novo', valor_unitario: 49.9 },
      { quantidade: 2, tipo_linha: 'portabilidade', valor_unitario: 59.9 }
    ]);
    assert.equal(resultado.vendas[2].tipo_venda, 'Novo');
    assert.deepEqual(resultado.vendas[2].chips, [{ quantidade: 3, tipo_linha: 'novo', valor_unitario: 39.9 }]);
    assert.equal(resultado.vendas[3].tipo_venda, 'Portabilidade');
    assert.deepEqual(resultado.vendas[3].chips, []);
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
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
    ['Aguardando Aceite/Assinatura', 'Bom dia, favor verificar se o cliente ainda tem interesse no pedido.', 'Correção do Pedido de Venda Pelo Consultor', 'tipo_2', null],
    ['Aguardando Aceite/Assinatura', 'seguir', 'Análise da Qualidade e Auditoria', 'tipo_1', 'apos_aceite_biometria'],
    ['Correção do Pedido de Venda Pelo Consultor', 'ignorar esta mensagem e manter a venda', 'Vivocorp - Pedidos > Backoffice Aprovado', 'tipo_1', 'apos_aceite_biometria'],
    ['Aguardando Aceite/Assinatura', 'Fase de Contrato Aguardando Carteirização', 'Pendência Pré-Venda', 'tipo_1', 'aceite_biometria'],
    ['Correção do Pedido de Venda Pelo Consultor', 'pode enviar, cliente tem aceite', 'Suporte Pré-Venda', 'tipo_1', 'aceite_biometria'],
    ['Vivocorp - Pedidos > Backoffice Aprovado', 'Processo de importação manual por Arquivo InfoB2B', 'Vivocorp - Pedidos > Cancelado Manualmente', 'cancelamento', 'cancelar_venda']
  ];

  for (const [origem, mensagem, destino, classificacao, alvo] of exemplos) {
    const resultado = parser.interpretarEmail(`Workflow (tramitação do pedido)\nOrigem: ${origem}\nMensagem ao Operador: ${mensagem}\nDestino: ${destino}`);
    assert.equal(resultado.origem, origem);
    assert.equal(resultado.destino, destino);
    assert.equal(resultado.classificacao, classificacao, destino);
    assert.equal(resultado.alvo, alvo, destino);
  }
});

test('classifica os novos destinos mesmo quando os acentos chegam corrompidos', () => {
  const exemplos = [
    ['An lise da Qualidade e Auditoria', 'tipo_1', 'apos_aceite_biometria'],
    ['Vivocorp - Pedidos > Backoffice Aprovado', 'tipo_1', 'apos_aceite_biometria'],
    ['Pend ncia Pr -Venda', 'tipo_1', 'aceite_biometria'],
    ['Suporte Pr -Venda', 'tipo_1', 'aceite_biometria'],
    ['Vivocorp - Pedidos > Cancelado Manualmente', 'cancelamento', 'cancelar_venda']
  ];

  for (const [destino, classificacao, alvo] of exemplos) {
    assert.deepEqual(parser.classificarDestino(destino), { classificacao, alvo }, destino);
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

test('CNPJ com uma unica venda ativa e divergencias segue para revisao', () => {
  const venda = {
    id: 1,
    nome: 'Empresa Exemplo',
    razao_social: 'Empresa Exemplo LTDA',
    status_funil: 'ativacao',
    status_funil_nome: 'Ativação',
    data_venda: '2026-08-25',
    quantidade_linhas: 2,
    valor_total: 100,
    vendedora: { id: 3, nome: 'Consultora Principal' },
    vendedoras: [{ id: 4, nome: 'Consultora Compartilhada' }],
    criador: { id: 7, nome: 'Gerente' }
  };
  const resultado = automacao._internals.avaliarCandidatas(
    [venda],
    { data_venda: '2026-08-24', quantidade: 1, valor_mensal: 54.99 },
    ['concluido']
  );
  assert.equal(resultado.venda, null);
  assert.deepEqual(resultado.candidatas[0].divergencias, ['data da venda divergente', 'quantidade divergente', 'valor mensal divergente']);
  assert.equal(resultado.candidatas[0].elegivel, true);
  assert.equal(resultado.candidatas[0].automaticamente_compativel, false);
  assert.match(resultado.erro, /revisão manual/);
  assert.equal(resultado.candidatas[0].status_funil_nome, 'Ativação');
  assert.equal(resultado.candidatas[0].razao_social, 'Empresa Exemplo LTDA');
  assert.equal(resultado.candidatas[0].data_venda, '2026-08-25');
  assert.equal(resultado.candidatas[0].valor_total, 100);
  assert.deepEqual(resultado.candidatas[0].vendedores, [
    { id: 3, nome: 'Consultora Principal' },
    { id: 4, nome: 'Consultora Compartilhada' }
  ]);
  assert.deepEqual(resultado.candidatas[0].criador, { id: 7, nome: 'Gerente' });
});

test('email anterior ao cadastro nunca seleciona a venda automaticamente', () => {
  const venda = { id: 1, status_funil: 'ativacao', criado_em: '2026-09-08 12:00:00', data_venda: '2026-09-08' };
  const resultado = automacao._internals.avaliarCandidatas(
    [venda],
    { data_venda: '2026-09-08' },
    ['concluido'],
    { recebidoEm: '2026-09-02 12:00:00' }
  );
  assert.equal(resultado.venda, null);
  assert.deepEqual(resultado.candidatas[0].divergencias, ['e-mail recebido antes da criação da venda']);
  assert.equal(resultado.candidatas[0].automaticamente_compativel, false);
});

test('revalida venda manual no CNPJ pesquisado e nas regras atuais da automacao', async () => {
  const registro = {
    venda_id: null,
    dados_extraidos: JSON.stringify({
      documento: '11143938000187',
      classificacao: 'tipo_1',
      data_venda: '2026-08-24',
      candidatas: [{ id: 99, elegivel: true }]
    })
  };
  const venda = { id: 51, status_funil: 'entrega', cancelada_em: null, excluido_em: null };
  const chamadas = [];

  const resultado = await automacao._internals.validarVendaSelecionada(
    registro,
    { venda_id: 51, cnpj_venda: '17025544000704', classificacao: 'tipo_1' },
    {
      buscar: async campos => { chamadas.push(campos.documento); return [venda]; },
      etapasFinais: async () => ['concluido']
    }
  );

  assert.equal(resultado.venda, venda);
  assert.equal(resultado.cnpj, '17025544000704');
  assert.deepEqual(chamadas, ['17025544000704']);

  await assert.rejects(
    automacao._internals.validarVendaSelecionada(
      registro,
      { venda_id: 99, cnpj_venda: '17025544000704', classificacao: 'tipo_1' },
      { buscar: async () => [venda], etapasFinais: async () => ['concluido'] }
    ),
    error => error.statusCode === 400 && /não pertence ao CNPJ/.test(error.message)
  );

  await assert.rejects(
    automacao._internals.validarVendaSelecionada(
      registro,
      { venda_id: 51, cnpj_venda: '17025544000704', classificacao: 'tipo_1' },
      { buscar: async () => [{ ...venda, status_funil: 'concluido' }], etapasFinais: async () => ['concluido'] }
    ),
    error => error.statusCode === 400 && /não está ativa/.test(error.message)
  );
});

test('revisao manual rejeita venda fora das candidatas do documento', async () => {
  const queryOriginal = AutomacaoEmail.query;
  const registro = {
    id: 10,
    venda_id: null,
    dados_extraidos: JSON.stringify({
      documento: '11143938000187',
      candidatas: [{ id: 51, nome: 'Venda correta', elegivel: true }]
    })
  };
  AutomacaoEmail.query = () => ({ findById: async () => registro });
  try {
    await assert.rejects(
      automacao.revisar(
        10,
        { venda_id: 99, justificativa: 'Conferência manual' },
        7,
        {
          buscar: async () => [{ id: 51, status_funil: 'entrega' }],
          etapasFinais: async () => ['concluido']
        }
      ),
      error => error.statusCode === 400 && /não pertence ao CNPJ/.test(error.message)
    );
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
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
  const ativa = { id: 1, status_funil: 'entrega', data_venda: '2026-08-24', quantidade_linhas: 1, valor_total: 54.99 };
  const concluida = { ...ativa, id: 2, status_funil: 'final_personalizado' };
  const cancelada = { ...ativa, id: 3, cancelada_em: '2026-08-30' };
  const excluida = { ...ativa, id: 4, excluido_em: '2026-08-30' };
  const resultado = automacao._internals.avaliarCandidatas([concluida, cancelada, excluida, ativa], campos, ['final_personalizado']);
  assert.equal(resultado.venda, ativa);
  assert.deepEqual(resultado.candidatas.map(item => item.elegivel), [false, false, false, true]);
  assert.deepEqual(resultado.candidatas[0].inelegibilidades, ['venda concluída']);
});

test('cancelamento prioriza venda ativa e aceita uma unica cancelada como repeticao idempotente', () => {
  const ativa = { id: 1, status_funil: 'entrega', cancelada_em: null, excluido_em: null };
  const cancelada = { id: 2, status_funil: 'entrega', cancelada_em: '2026-09-01', excluido_em: null };
  let resultado = automacao._internals.avaliarCandidatas(
    [cancelada, ativa], {}, ['concluido'], { cancelamento: true }
  );
  assert.equal(resultado.venda, ativa);

  resultado = automacao._internals.avaliarCandidatas(
    [cancelada], {}, ['concluido'], { cancelamento: true }
  );
  assert.equal(resultado.venda, cancelada);
  assert.equal(resultado.candidatas[0].elegivel, true);

  resultado = automacao._internals.avaliarCandidatas(
    [{ ...ativa, status_funil: 'concluido' }], {}, ['concluido'], { cancelamento: true }
  );
  assert.equal(resultado.venda, null);
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
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
  Venda.query = () => ({
    findById: () => ({
      withGraphFetched: async () => ({ id: 9, status_funil: 'final_personalizado', excluido_em: null, cancelada_em: null })
    })
  });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'final_personalizado' }] });
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  try {
    const resultado = await automacao._internals.resolverVenda({ revisado_por_id: 3, venda_id: 9 }, {});
    assert.equal(resultado.venda, null);
    assert.match(resultado.erro, /não pode receber atualizações/);
    assert.equal(resultado.candidatas[0].manual, true);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

test('endpoints administrativos de historico ficam protegidos e preservam seus contratos', async () => {
  const camadas = automacaoRoutes.stack;
  const indicePermissao = camadas.findIndex(camada => camada.name === 'permissaoMiddleware');
  const contratos = [
    ['/inconsistencias-historico', 'get'],
    ['/inconsistencias-historico/:historicoId', 'get'],
    ['/inconsistencias-historico/:historicoId/corrigir', 'post']
  ];
  for (const [caminho, metodo] of contratos) {
    const camada = camadas.find(item => item.route?.path === caminho);
    assert.ok(camada, caminho);
    assert.ok(camadas.indexOf(camada) > indicePermissao, caminho);
    assert.equal(camada.route.methods[metodo], true, caminho);
  }

  const listarOriginal = automacao.listarInconsistenciasHistorico;
  const previaOriginal = automacao.obterPreviaCorrecaoHistorico;
  const corrigirOriginal = automacao.corrigirInconsistenciaHistorico;
  const chamadas = [];
  automacao.listarInconsistenciasHistorico = async filtros => { chamadas.push(['listar', filtros]); return { data: [], total: 0 }; };
  automacao.obterPreviaCorrecaoHistorico = async id => { chamadas.push(['previa', id]); return { historico_id: Number(id) }; };
  automacao.corrigirInconsistenciaHistorico = async (id, dados, usuarioId) => { chamadas.push(['corrigir', id, dados, usuarioId]); return { status: 'ok' }; };
  const resposta = () => ({ body: null, json(dados) { this.body = dados; return this; }, status() { return this; } });
  try {
    await automacaoController.inconsistenciasHistorico({ query: { page: '2' } }, resposta());
    await automacaoController.previaCorrecaoHistorico({ params: { historicoId: '70' } }, resposta());
    await automacaoController.corrigirHistorico({ params: { historicoId: '70' }, body: { motivo: 'Incorreto' }, usuario: { id: 7 } }, resposta());
    assert.deepEqual(chamadas, [
      ['listar', { page: '2' }],
      ['previa', '70'],
      ['corrigir', '70', { motivo: 'Incorreto' }, 7]
    ]);
  } finally {
    automacao.listarInconsistenciasHistorico = listarOriginal;
    automacao.obterPreviaCorrecaoHistorico = previaOriginal;
    automacao.corrigirInconsistenciaHistorico = corrigirOriginal;
  }
});

test('revisao manual aceita divergencias depois da selecao humana auditada', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
  const escolhida = {
    id: 9,
    status_funil: 'entrega',
    criado_em: '2026-09-08 12:00:00',
    data_venda: '2026-09-08',
    quantidade_linhas: 2,
    valor_total: 100,
    excluido_em: null,
    cancelada_em: null
  };
  Venda.query = () => ({ findById: () => ({ withGraphFetched: async () => escolhida }) });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'concluido' }] });
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  try {
    const resultado = await automacao._internals.resolverVenda({
      revisado_por_id: 3,
      venda_id: 9,
      recebido_em: '2026-09-02 12:00:00'
    }, { data_venda: '2026-09-01', quantidade: 1, valor_mensal: 54.99 });
    assert.equal(resultado.venda.id, escolhida.id);
    assert.equal(resultado.venda.status_funil, escolhida.status_funil);
    assert.equal(resultado.erro, null);
    assert.equal(resultado.candidatas[0].manual, true);
    assert.equal(resultado.candidatas[0].automaticamente_compativel, false);
    assert.deepEqual(resultado.candidatas[0].divergencias, [
      'data da venda divergente',
      'quantidade divergente',
      'valor mensal divergente',
      'e-mail recebido antes da criação da venda'
    ]);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
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

test('cursor trata datetime SQL como UTC mesmo no fuso de Sao Paulo', () => {
  const timezoneAnterior = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const inicio = new Date('2026-08-20T03:00:00.000Z');
    assert.equal(
      automacao._internals.calcularDepois(inicio, '2026-08-30 12:00:00', false),
      automacao._internals.calcularDepois(inicio, '2026-08-30T12:00:00.000Z', false)
    );
  } finally {
    if (timezoneAnterior === undefined) delete process.env.TZ;
    else process.env.TZ = timezoneAnterior;
  }
});

test('deduplicacao nao consulta novamente uma mensagem ja registrada', async () => {
  const queryOriginal = AutomacaoEmail.query;
  AutomacaoEmail.query = () => ({ findOne: async filtro => ({ id: 8, ...filtro }) });
  try {
    assert.equal(await automacao._internals.registrarMensagem({ id: 'gmail-repetido' }, 'token'), false);
  } finally {
    AutomacaoEmail.query = queryOriginal;
  }
});

test('valida a conta vinculada sem expor os enderecos no erro', async () => {
  const contaAnterior = process.env.GMAIL_VIVO_ACCOUNT;
  process.env.GMAIL_VIVO_ACCOUNT = 'automacao@empresa.example';
  try {
    await assert.rejects(
      automacao._internals.validarContaGmail('token', async (caminho, token) => {
        assert.deepEqual([caminho, token], ['profile', 'token']);
        return { data: { emailAddress: 'outra-conta@empresa.example' } };
      }),
      error => error.code === 'GMAIL_ACCOUNT_MISMATCH'
        && !error.message.includes('automacao@')
        && !error.message.includes('outra-conta@')
    );
  } finally {
    if (contaAnterior === undefined) delete process.env.GMAIL_VIVO_ACCOUNT;
    else process.env.GMAIL_VIVO_ACCOUNT = contaAnterior;
  }
});

test('coleta todo o backlog paginado e conta somente mensagens novas', async () => {
  const habilitadaAnterior = process.env.GMAIL_VIVO_AUTOMATION_ENABLED;
  const inicioAnterior = process.env.GMAIL_VIVO_PROCESS_AFTER;
  const contaAnterior = process.env.GMAIL_VIVO_ACCOUNT;
  const queryOriginal = AutomacaoEmail.query;
  process.env.GMAIL_VIVO_AUTOMATION_ENABLED = 'true';
  process.env.GMAIL_VIVO_PROCESS_AFTER = '2026-08-20T03:00:00.000Z';
  delete process.env.GMAIL_VIVO_ACCOUNT;
  AutomacaoEmail.query = () => ({ max() { return this; }, first: async () => ({ valor: '2026-09-04 20:16:01' }) });
  const consultas = [];
  try {
    const resultado = await automacao.coletarEmails({}, {
      tokenAcesso: async () => 'token',
      gmailGet: async (caminho, token, params) => {
        consultas.push({ caminho, token, params });
        return params.pageToken
          ? { data: { messages: [{ id: 'nova-3' }] } }
          : { data: { messages: [{ id: 'existente' }, { id: 'nova-2' }], nextPageToken: 'pagina-2' } };
      },
      registrarMensagem: async item => item.id !== 'existente'
    });
    assert.deepEqual(resultado, { habilitado: true, coletados: 2 });
    assert.equal(consultas.length, 2);
    assert.equal(consultas[0].params.q, `after:${Math.floor(Date.parse('2026-09-04T20:16:01Z') / 1000) - 300}`);
    assert.equal(consultas[1].params.pageToken, 'pagina-2');
  } finally {
    AutomacaoEmail.query = queryOriginal;
    if (habilitadaAnterior === undefined) delete process.env.GMAIL_VIVO_AUTOMATION_ENABLED;
    else process.env.GMAIL_VIVO_AUTOMATION_ENABLED = habilitadaAnterior;
    if (inicioAnterior === undefined) delete process.env.GMAIL_VIVO_PROCESS_AFTER;
    else process.env.GMAIL_VIVO_PROCESS_AFTER = inicioAnterior;
    if (contaAnterior === undefined) delete process.env.GMAIL_VIVO_ACCOUNT;
    else process.env.GMAIL_VIVO_ACCOUNT = contaAnterior;
  }
});

function criarBancoEstado(estadoInicial = { id: 1, estado: 'aguardando', falhas_consecutivas: 0 }) {
  let estado = { ...estadoInicial };
  function database(tabela) {
    assert.equal(tabela, 'automacao_email_estado');
    return {
      where(filtro) { assert.deepEqual(filtro, { id: 1 }); return this; },
      first: async () => ({ ...estado }),
      async update(patch) { estado = { ...estado, ...patch }; return 1; },
      insert(patch) {
        return { onConflict: () => ({ merge: async () => { estado = { ...estado, ...patch }; } }) };
      }
    };
  }
  return { database, estado: () => estado };
}

test('ciclo persiste sucesso e recupera o contador depois de uma falha por fase', async () => {
  const banco = criarBancoEstado({ id: 1, estado: 'erro', falhas_consecutivas: 2 });
  await automacao.ciclo({
    database: banco.database,
    coletarEmails: async () => ({ habilitado: true, coletados: 7 }),
    processarPendentes: async () => 3,
    repetirTelegrams: async () => undefined
  });
  assert.equal(banco.estado().estado, 'ok');
  assert.equal(banco.estado().falhas_consecutivas, 0);
  assert.equal(banco.estado().emails_ultimo_ciclo, 7);
  assert.ok(banco.estado().ultimo_sucesso_em);
});

test('ciclo registra a fase e relanca o erro original com mensagem sanitizada', async () => {
  const banco = criarBancoEstado();
  const falha = Object.assign(new Error('access_token=segredo recusado'), {
    response: { status: 401, data: { error: 'invalid_grant', error_description: 'refresh_token=segredo expirado' } }
  });
  await assert.rejects(
    automacao.ciclo({
      database: banco.database,
      coletarEmails: async () => ({ habilitado: true, coletados: 2 }),
      processarPendentes: async () => { throw falha; },
      repetirTelegrams: async () => undefined
    }),
    error => error === falha
  );
  assert.equal(banco.estado().estado, 'erro');
  assert.equal(banco.estado().fase_erro, 'processamento');
  assert.equal(banco.estado().falhas_consecutivas, 1);
  assert.match(banco.estado().ultimo_erro, /Google 401/);
  assert.match(banco.estado().ultimo_erro, /invalid_grant/);
  assert.doesNotMatch(banco.estado().ultimo_erro, /segredo/);
});

test('erro do IMAP preserva a resposta util do servidor em vez de Command failed', () => {
  const falha = Object.assign(new Error('Command failed'), {
    authenticationFailed: true,
    responseStatus: 'NO',
    serverResponseCode: 'AUTHENTICATIONFAILED',
    responseText: 'Authentication failed: password=segredo'
  });

  const mensagem = automacao._internals.mensagemErroIntegracao(falha);

  assert.match(mensagem, /Falha de autenticação IMAP/);
  assert.match(mensagem, /IMAP NO/);
  assert.match(mensagem, /AUTHENTICATIONFAILED/);
  assert.doesNotMatch(mensagem, /Command failed/);
  assert.doesNotMatch(mensagem, /segredo/);
});

test('mantem integração em falha enquanto uma nova tentativa está processando', () => {
  const intervalo = 60000;
  const registro = {
    estado: 'processando',
    fase_erro: 'coleta',
    ultimo_inicio_em: new Date().toISOString(),
    ultimo_erro: 'CONNECT_TIMEOUT',
    falhas_consecutivas: 2
  };

  assert.equal(automacao._internals.estadoPublicoIntegracao(registro, true, intervalo), 'falha');
  assert.equal(automacao._internals.estadoPublicoIntegracao({ ...registro, estado: 'ok', ultimo_erro: null }, true, intervalo), 'ativo');
});

test('inicio de uma nova tentativa preserva a fase e o erro anteriores', async () => {
  const banco = criarBancoEstado({
    id: 1,
    estado: 'erro',
    fase_erro: 'coleta',
    ultimo_erro: 'CONNECT_TIMEOUT',
    falhas_consecutivas: 2
  });

  await automacao._internals.registrarInicioCiclo(banco.database);

  assert.equal(banco.estado().estado, 'processando');
  assert.equal(banco.estado().fase_erro, 'coleta');
  assert.equal(banco.estado().ultimo_erro, 'CONNECT_TIMEOUT');
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

test('pagina automacoes por status e classificacao com ordenacao deterministica', async () => {
  const queryOriginal = AutomacaoEmail.query;
  const chamadas = [];
  class QueryAutomacao {
    orderBy(campo, direcao) { chamadas.push(['orderBy', campo, direcao]); return this; }
    where(campo, valor) { chamadas.push(['where', campo, valor]); return this; }
    whereRaw(sql, parametros) { chamadas.push(['whereRaw', sql, parametros]); return this; }
    async page(offset, limite) {
      chamadas.push(['page', offset, limite]);
      return { total: 121, results: [{ id: 7, dados_extraidos: '{"destino":"Entrega"}' }] };
    }
  }
  AutomacaoEmail.query = () => new QueryAutomacao();
  try {
    const resultado = await automacao.listar({ status: 'concluido', classificacao: 'cancelamento', titulo: '  Análise 100%_VIVO  ', page: 2, per_page: 100 });
    assert.deepEqual(chamadas, [
      ['orderBy', 'recebido_em', 'desc'],
      ['orderBy', 'id', 'desc'],
      ['where', 'status', 'concluido'],
      ['where', 'classificacao', 'cancelamento'],
      ['whereRaw', "LOCATE(LOWER(?), LOWER(COALESCE(assunto, ''))) > 0", ['Análise 100%_VIVO']],
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

test('resume status e cancelamentos sem incluir a classificacao no total por status', async () => {
  let consulta = 0;
  const banco = () => {
    consulta += 1;
    if (consulta === 1) {
      return {
        select(campo) { assert.equal(campo, 'status'); return this; },
        count(expressao) { assert.equal(expressao, '* as total'); return this; },
        async groupBy(campo) {
          assert.equal(campo, 'status');
          return [{ status: 'concluido', total: '4' }, { status: 'revisao', total: '1' }];
        }
      };
    }
    if (consulta === 2) {
      return {
        where(campo, valor) { assert.deepEqual([campo, valor], ['classificacao', 'cancelamento']); return this; },
        count(expressao) { assert.equal(expressao, '* as total'); return this; },
        async first() { return { total: '2' }; }
      };
    }
    if (consulta === 3) return {
      max(expressao) { assert.equal(expressao, 'recebido_em as recebido_em'); return this; },
      async first() { return { recebido_em: '2026-09-03 12:00:00' }; }
    };
    return {
      where(filtro) { assert.deepEqual(filtro, { id: 1 }); return this; },
      async first() {
        return {
          estado: 'ok', ultimo_inicio_em: new Date().toISOString(), ultimo_sucesso_em: '2026-09-03 12:01:00',
          falhas_consecutivas: 0, emails_ultimo_ciclo: 2
        };
      }
    };
  };

  const habilitadaAnterior = process.env.GMAIL_VIVO_AUTOMATION_ENABLED;
  process.env.GMAIL_VIVO_AUTOMATION_ENABLED = 'true';
  let resultado;
  try {
    resultado = await automacao.resumo(banco);
  } finally {
    if (habilitadaAnterior === undefined) delete process.env.GMAIL_VIVO_AUTOMATION_ENABLED;
    else process.env.GMAIL_VIVO_AUTOMATION_ENABLED = habilitadaAnterior;
  }

  assert.deepEqual(resultado.contadores, { concluido: 4, revisao: 1 });
  assert.deepEqual(resultado.contadores_classificacao, { cancelamento: 2 });
  assert.equal(Object.values(resultado.contadores).reduce((total, valor) => total + valor, 0), 5);
  assert.equal(resultado.integracao.estado, 'ativo');
  assert.equal(resultado.integracao.emails_ultimo_ciclo, 2);
});

test('enriquece candidatas antigas com o nome atual da etapa do funil', async () => {
  const queryOriginal = FunilEtapa.query;
  FunilEtapa.query = () => ({
    whereIn(campo, codigos) {
      assert.equal(campo, 'codigo');
      assert.deepEqual(codigos, ['entrega']);
      return this;
    },
    select: async () => [{ codigo: 'entrega', nome: 'Entrega' }]
  });
  try {
    const [item] = await automacao._internals.enriquecerEtapasCandidatas([{
      id: 10,
      dados_extraidos: { candidatas: [{ id: 51, status_funil: 'entrega', elegivel: true }] }
    }]);
    assert.equal(item.dados_extraidos.candidatas[0].status_funil_nome, 'Entrega');
  } finally {
    FunilEtapa.query = queryOriginal;
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

test('movimentacao processada pelo Gmail envia origem e id ao funil automatico', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaFunilAutomacaoService.movimentar;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
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
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  vendaFunilAutomacaoService.movimentar = async (...args) => {
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
    assert.deepEqual(chamada[2], {
      origem: 'automacao_gmail',
      automacaoEmailId: 88
    });
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaFunilAutomacaoService.movimentar = atualizarOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

test('cancelamento automatico usa mensagem, fallback e contexto do Gmail sem mover etapa', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const cancelarOriginal = vendaFunilAutomacaoService.cancelar;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
  const chamadas = [];
  let venda = { id: 41, status_funil: 'entrega', excluido_em: null, cancelada_em: null };

  Venda.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => venda
  });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'concluido' }] });
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  vendaFunilAutomacaoService.cancelar = async (...args) => { chamadas.push(args); return { status: 'ok' }; };

  const registro = (mensagem, destino = 'Pedido Cancelado pelo Consultor') => ({
    id: 92,
    venda_id: 41,
    revisado_por_id: 7,
    corpo_texto: '',
    dados_extraidos: JSON.stringify({
      _override: {
        classificacao: 'cancelamento', alvo: 'cancelar_venda', documento: '11143938000187',
        destino, mensagem_operador: mensagem
      }
    })
  });

  try {
    let resultado = await automacao._internals.processarRegistro(registro('cancelar'));
    assert.equal(resultado.status, 'concluido');
    assert.equal(resultado.classificacao, 'cancelamento');
    assert.equal(resultado.etapa_destino, null);
    assert.deepEqual(chamadas[0], [41, { motivo: 'cancelar' }, {
      origem: 'automacao_gmail', automacaoEmailId: 92
    }]);

    resultado = await automacao._internals.processarRegistro(registro(''));
    assert.equal(resultado.status, 'concluido');
    assert.equal(chamadas[1][1].motivo, 'Pedido cancelado pelo consultor');

    resultado = await automacao._internals.processarRegistro(registro('', 'Pedido Cancelado pelo Cliente'));
    assert.equal(resultado.status, 'concluido');
    assert.equal(chamadas[2][1].motivo, 'Pedido cancelado pelo cliente');

    venda = { ...venda, status_funil: 'concluido' };
    resultado = await automacao._internals.processarRegistro(registro('cancelar'));
    assert.equal(resultado.status, 'revisao');
    assert.match(resultado.erro, /concluída/);
    assert.equal(chamadas.length, 3);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaFunilAutomacaoService.cancelar = cancelarOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

test('cancelamento oficial por sistema bloqueia a venda e e idempotente com auditoria e notificacao unicas', async () => {
  const queryVendaOriginal = Venda.query;
  const transactionOriginal = Venda.transaction;
  const queryHistoricoOriginal = VendaHistorico.query;
  const notificarOriginal = vendaNotificacaoCancelamentoService.criarNotificacaoCancelamento;
  const venda = { id: 41, status_funil: 'entrega', cancelada_em: null, excluido_em: null };
  const historicos = [];
  const notificacoes = [];
  let bloqueios = 0;

  Venda.transaction = async callback => callback({ id: 'trx' });
  Venda.query = trx => ({
    findById(id) { assert.equal(id, 41); return this; },
    async forUpdate() { bloqueios += 1; return { ...venda }; },
    async patchAndFetchById(id, patch) { assert.equal(id, 41); Object.assign(venda, patch); return { ...venda }; }
  });
  VendaHistorico.query = trx => ({
    async insert(dados) { assert.deepEqual(trx, { id: 'trx' }); historicos.push(dados); return dados; }
  });
  vendaNotificacaoCancelamentoService.criarNotificacaoCancelamento = async dados => { notificacoes.push(dados); };

  const opcoes = {
    motivo: 'cancelar', usuarioId: null, sistema: true,
    origemMovimentacao: 'automacao_gmail', automacaoEmailId: 92,
    statusFunilEsperado: 'entrega'
  };
  try {
    let resultado = await vendaService.cancelarVenda(41, opcoes);
    assert.equal(resultado.status, 'ok');
    assert.equal(resultado.alterada, true);
    assert.equal(venda.cancelada_por_id, null);
    assert.equal(historicos.length, 1);
    assert.equal(historicos[0].usuario_id, null);
    assert.deepEqual(JSON.parse(historicos[0].dados), {
      motivo_cancelamento: 'cancelar', origem_movimentacao: 'automacao_gmail', automacao_email_id: 92
    });
    assert.equal(notificacoes.length, 1);
    assert.equal(notificacoes[0].usuarioId, null);

    resultado = await vendaService.cancelarVenda(41, opcoes);
    assert.equal(resultado.status, 'ok');
    assert.equal(resultado.alterada, false);
    assert.equal(bloqueios, 2);
    assert.equal(historicos.length, 1);
    assert.equal(notificacoes.length, 1);
  } finally {
    Venda.query = queryVendaOriginal;
    Venda.transaction = transactionOriginal;
    VendaHistorico.query = queryHistoricoOriginal;
    vendaNotificacaoCancelamentoService.criarNotificacaoCancelamento = notificarOriginal;
  }
});

test('cancelamento manual continua exigindo a permissao existente', async () => {
  const queryUsuarioOriginal = Usuario.query;
  const transactionOriginal = Venda.transaction;
  let abriuTransacao = false;
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => null
  });
  Venda.transaction = async () => { abriuTransacao = true; };
  try {
    const resultado = await vendaService.cancelarVenda(41, { motivo: 'cancelar', usuarioId: 7 });
    assert.equal(resultado.status, 'forbidden');
    assert.equal(abriuTransacao, false);
  } finally {
    Usuario.query = queryUsuarioOriginal;
    Venda.transaction = transactionOriginal;
  }
});

test('cancelamento automatico recusa mudanca concorrente de etapa', async () => {
  const queryVendaOriginal = Venda.query;
  const transactionOriginal = Venda.transaction;
  Venda.transaction = async callback => callback({});
  Venda.query = () => ({
    findById() { return this; },
    forUpdate: async () => ({ id: 41, status_funil: 'concluido', cancelada_em: null, excluido_em: null })
  });
  try {
    const resultado = await vendaService.cancelarVenda(41, {
      motivo: 'cancelar', usuarioId: null, sistema: true, statusFunilEsperado: 'entrega'
    });
    assert.equal(resultado.status, 'invalid');
    assert.match(resultado.message, /mudou de etapa/);
  } finally {
    Venda.query = queryVendaOriginal;
    Venda.transaction = transactionOriginal;
  }
});

test('destino neutro conclui sem mover a venda nem abrir problema', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaFunilAutomacaoService.movimentar;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
  let tentouMover = false;

  Venda.query = () => ({
    findById() { return this; },
    withGraphFetched: async () => ({ id: 41, status_funil: 'ativacao', excluido_em: null, cancelada_em: null })
  });
  FunilEtapa.query = () => ({ where: async () => [{ codigo: 'concluido' }] });
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  vendaFunilAutomacaoService.movimentar = async () => { tentouMover = true; return { status: 'ok' }; };

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
    vendaFunilAutomacaoService.movimentar = atualizarOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

test('logistica concluida finaliza venda nova e envia portabilidade para confirmacao de SMS', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaFunilAutomacaoService.movimentar;
  const etapaFinal = { codigo: 'final_personalizado', ordem: 5, ativo: true, etapa_final: true };
  const etapaSms = { codigo: 'sms_portabilidade', nome: 'Confirmação SMS Portabilidade', ordem: 4, ativo: true };
  let vendaAtual;
  const movimentos = [];

  Venda.query = () => ({
    porId: false,
    findById() { this.porId = true; return this; },
    alias() { return this; },
    leftJoinRelated() { return this; },
    leftJoin() { return this; },
    select() { return this; },
    where() { return this; },
    whereNull() { return this; },
    withGraphFetched() { return Promise.resolve(this.porId ? vendaAtual : [vendaAtual]); }
  });
  FunilEtapa.query = () => ({
    where: async filtros => filtros?.etapa_final ? [etapaFinal] : [etapaSms, etapaFinal],
    findOne: async filtros => [etapaFinal, etapaSms].find(etapa => etapa.codigo === filtros.codigo) || { codigo: 'ativacao', ordem: 2 }
  });
  vendaFunilAutomacaoService.movimentar = async (...args) => { movimentos.push(args); return { status: 'ok' }; };

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
    vendaFunilAutomacaoService.movimentar = atualizarOriginal;
  }
});

test('pedido na operadora avanca apos aceite sem repetir movimento nem regredir o funil', async () => {
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const atualizarOriginal = vendaFunilAutomacaoService.movimentar;
  const queryFunilAutomacaoOriginal = VendaFunilAutomacao.query;
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
  VendaFunilAutomacao.query = () => ({ findById: async () => null });
  vendaFunilAutomacaoService.movimentar = async (...args) => {
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
    assert.deepEqual(movimentos[0][2], {
      origem: 'automacao_gmail',
      automacaoEmailId: 88
    });

    statusAtual = 'pos_aceite';
    movimentos = [];
    resultado = await automacao._internals.processarRegistro(registro());
    assert.equal(resultado.status, 'concluido');
    assert.equal(movimentos.length, 0);

    statusAtual = 'entrega';
    resultado = await automacao._internals.processarRegistro(registro());
    assert.equal(resultado.status, 'regressao_funil');
    assert.match(resultado.erro, /regredir o funil/);
    assert.equal(movimentos.length, 0);
  } finally {
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
    vendaFunilAutomacaoService.movimentar = atualizarOriginal;
    VendaFunilAutomacao.query = queryFunilAutomacaoOriginal;
  }
});

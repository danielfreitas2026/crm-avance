const test = require('node:test');
const assert = require('node:assert/strict');

const { montarPayloadVenda, resolverIdReferencia, _internals } = require('../src/services/dashboard-integracao.service');

const referencias = {
  sellers: [{ id: 11, full_name: 'Ana Vendedora' }],
  services: [{ id: 12, name: 'Internet' }],
  operators: [{ id: 13, name: 'Claro' }],
  sale_types: [{ id: 14, code: 'portability', name: 'Portabilidade' }, { id: 15, code: 'new', name: 'Novo' }]
};

test('monta o payload aceito pelo dashboard a partir da venda local', () => {
  const payload = montarPayloadVenda({
    id: 42,
    data_venda: '2026-07-28',
    criado_em: '2026-07-28 14:30:00',
    cnpj: '07.404.596/0001-34',
    razao_social: 'Empresa Exemplo',
    telefone: '(11) 99999-9999',
    nome_fechou_venda: 'Fechador',
    quantidade_linhas: 2,
    valor_total: 199.8,
    possui_doc_na_casa: 1,
    cliente_da_base: false,
    observacoes: 'Observacao',
    vendedora: { id: 1, nome: 'Ana Vendedora' },
    servico: { id: 2, nome: 'Internet' },
    operadora: { id: 3, nome: 'Claro' },
    tipoVenda: { id: 4, nome: 'Portabilidade' }
  }, referencias);

  assert.deepEqual(payload, {
    external_sale_id: 'crm-venda-42',
    seller_id: 11,
    service_id: 12,
    operator_id: 13,
    sale_type_id: 14,
    sale_date: '2026-07-28',
    sale_time: '11:30',
    cnpj: '07404596000134',
    company_name: 'Empresa Exemplo',
    phone: '11999999999',
    closed_by_name: 'Fechador',
    quantity: 2,
    unit_value: '99.90',
    has_doc: true,
    is_base_sale: false,
    notes: 'Observacao'
  });
});

test('usa o ID equivalente quando uma referencia possui o mesmo ID local', () => {
  assert.equal(resolverIdReferencia({
    referencias: { sellers: [{ id: 5, name: 'Nome diferente' }] },
    colecao: 'sellers',
    chaveMapa: 'seller',
    referenciaLocal: { id: 5, nome: 'Nome CRM' }
  }), 5);
});

test('converte a hora UTC da venda para o horário de São Paulo', () => {
  const dataHora = _internals.formatarDataHoraVenda({
    data_venda: '2026-07-30',
    criado_em: '2026-07-30 20:23:00'
  });

  assert.deepEqual(dataHora, { sale_date: '2026-07-30', sale_time: '17:23' });
});

test('gera o mesmo identificador externo para criar e excluir cada lancamento', () => {
  assert.equal(_internals.idExternoVenda(42), 'crm-venda-42');
  assert.equal(_internals.idExternoVenda(42, 'chip-2'), 'crm-venda-42-chip-2');
});

test('edição usa PUT e não reenvia o identificador externo no corpo', async () => {
  const axios = require('axios');
  const putOriginal = axios.put;
  let requisicao;
  axios.put = async (url, body, options) => {
    requisicao = { url, body, options };
    return { data: { data: { id: 42 } } };
  };
  try {
    await _internals.atualizarLancamentoNoDashboard(
      'https://dashboard.example',
      'segredo',
      { external_sale_id: 'crm-venda-42-chip-1', quantity: 2 }
    );
    assert.equal(
      requisicao.url,
      'https://dashboard.example/api/v1/integration/sales/crm-venda-42-chip-1'
    );
    assert.deepEqual(requisicao.body, { quantity: 2 });
    assert.equal(requisicao.options.headers.Authorization, 'Bearer segredo');
  } finally {
    axios.put = putOriginal;
  }
});

test('usa o mapa configurado para vendedora mesmo com nomes diferentes', () => {
  process.env.DASHBOARD_INTEGRATION_SELLER_MAP = '{"1":11}';
  try {
    assert.equal(resolverIdReferencia({
      referencias: { sellers: [{ id: 11, full_name: 'Nome no Dashboard' }] },
      colecao: 'sellers',
      chaveMapa: 'seller',
      referenciaLocal: { id: 1, nome: 'Nome diferente no CRM' }
    }), 11);
  } finally {
    delete process.env.DASHBOARD_INTEGRATION_SELLER_MAP;
  }
});

test('separa chips de tipos, vendedoras e operadoras diferentes em lançamentos próprios', () => {
  const venda = {
    id: 50,
    data_venda: '2026-07-28',
    criado_em: '2026-07-28 14:30:00',
    nome: 'Empresa Exemplo',
    servico: { id: 2, nome: 'Internet' },
    possui_doc_na_casa: true,
    cliente_da_base: false,
    valores_unitarios_chips: JSON.stringify([
      { quantidade: 1, valor_unitario: '59.90', tipo_linha: 'novo', vendedora_id: 1, operadora_id: 3 },
      { quantidade: 2, valor_unitario: '79.90', tipo_linha: 'portabilidade', vendedora_id: 2, operadora_id: 4 }
    ]),
    _dashboardIntegration: {
      chips: [
        { quantidade: 1, valor_unitario: '59.90', tipo_linha: 'novo', vendedora_id: 1, operadora_id: 3 },
        { quantidade: 2, valor_unitario: '79.90', tipo_linha: 'portabilidade', vendedora_id: 2, operadora_id: 4 }
      ],
      vendedorasPorId: { 1: { id: 1, nome: 'Ana' }, 2: { id: 2, nome: 'Bia' } },
      operadorasPorId: { 3: { id: 3, nome: 'Claro' }, 4: { id: 4, nome: 'Vivo' } }
    }
  };
  const referenciasChips = {
    sellers: [{ id: 11, full_name: 'Ana' }, { id: 12, full_name: 'Bia' }],
    services: [{ id: 13, name: 'Internet' }],
    operators: [{ id: 14, name: 'Claro' }, { id: 15, name: 'Vivo' }],
    sale_types: [{ id: 16, code: 'new', name: 'Novo' }, { id: 17, code: 'portability', name: 'Portabilidade' }]
  };
  const primeiro = montarPayloadVenda(venda, referenciasChips, 'chip-1');
  const segundo = montarPayloadVenda(venda, referenciasChips, 'chip-2');
  assert.deepEqual({ external_sale_id: primeiro.external_sale_id, seller_id: primeiro.seller_id, operator_id: primeiro.operator_id, sale_type_id: primeiro.sale_type_id, quantity: primeiro.quantity, unit_value: primeiro.unit_value }, { external_sale_id: 'crm-venda-50-chip-1', seller_id: 11, operator_id: 14, sale_type_id: 16, quantity: 1, unit_value: '59.90' });
  assert.deepEqual({ external_sale_id: segundo.external_sale_id, seller_id: segundo.seller_id, operator_id: segundo.operator_id, sale_type_id: segundo.sale_type_id, quantity: segundo.quantity, unit_value: segundo.unit_value }, { external_sale_id: 'crm-venda-50-chip-2', seller_id: 12, operator_id: 15, sale_type_id: 17, quantity: 2, unit_value: '79.90' });
});

test('mantém detalhes de validação retornados pelo dashboard no erro de sincronização', () => {
  const mensagem = _internals.mensagemErro({ response: { data: { error: { message: 'Revise os campos informados.', fieldErrors: { notes: 'Campo inválido.' } } } } });
  assert.equal(mensagem, 'Revise os campos informados. (notes: Campo inválido.)');
});

test('mantém a mensagem de autenticação retornada pelo dashboard', () => {
  const mensagem = _internals.mensagemErro({ response: { data: { error: { code: 'AUTH_REQUIRED', message: 'Faça login para continuar.' } } } });
  assert.equal(mensagem, 'Faça login para continuar.');
});

test('envia observação vazia quando a venda não possui observações', () => {
  const payload = montarPayloadVenda({
    id: 60, data_venda: '2026-07-28', criado_em: '2026-07-28 14:30:00', nome: 'Empresa', quantidade_linhas: 1, valor_total: 10,
    vendedora: { id: 1, nome: 'Ana Vendedora' }, servico: { id: 2, nome: 'Internet' }, operadora: { id: 3, nome: 'Claro' }, tipoVenda: { id: 4, nome: 'Portabilidade' }
  }, referencias);
  assert.equal(payload.notes, '');
});

test('resume falha por chip e libera reenvio manual apenas quando elegível', () => {
  const resumo = _internals.montarResumo([
    { item_key: 'chip-1', status: 'enviada', ultimo_erro: null, pode_reenviar_manualmente: true },
    { item_key: 'chip-2', status: 'erro', ultimo_erro: 'Operadora não encontrada.', pode_reenviar_manualmente: true }
  ]);

  assert.deepEqual(resumo, {
    status: 'erro',
    mensagem: 'Operadora não encontrada.',
    pode_reenviar_manualmente: true,
    itens: [
      { item_key: 'chip-1', status: 'enviada', mensagem: null },
      { item_key: 'chip-2', status: 'erro', mensagem: 'Operadora não encontrada.' }
    ]
  });
});

test('não expõe rotina de reenvio automático', () => {
  const integracao = require('../src/services/dashboard-integracao.service');
  assert.equal(integracao.sincronizarPendentes, undefined);
  assert.equal(integracao.agendarEnvioVenda, undefined);
});

test('libera explicitamente uma venda antiga somente pela configuração de exceção', () => {
  process.env.DASHBOARD_INTEGRATION_MANUAL_RETRY_SALE_IDS = '91, 92';
  try {
    const resumo = _internals.montarResumo([
      { item_key: 'principal', status: 'erro', ultimo_erro: 'Falha.', pode_reenviar_manualmente: false }
    ], 92);
    assert.equal(resumo.pode_reenviar_manualmente, true);
  } finally {
    delete process.env.DASHBOARD_INTEGRATION_MANUAL_RETRY_SALE_IDS;
  }
});

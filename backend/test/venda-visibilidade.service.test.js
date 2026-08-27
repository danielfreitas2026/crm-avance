const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deveResumirVenda,
  garantirAcessoCompletoVenda,
  montarResumoVenda,
  sanitizarProblema,
  usuarioVinculadoVenda
} = require('../src/services/venda-visibilidade.service');

const consultora = {
  id: 9,
  ativo: true,
  role: { nome: 'usuario', permissoes: {} },
  permissoes: { vendas_ver_todas: true }
};

function venda(overrides = {}) {
  return {
    id: 7,
    criado_por_id: 9,
    vendedora_id: 9,
    vendedoras: [{ id: 9, nome: 'Ana' }],
    enviada_pos_venda_em: '2026-08-20 12:00:00',
    ...overrides
  };
}

test('restringe criadora, vendedora principal e participante depois do envio', () => {
  assert.equal(usuarioVinculadoVenda(venda(), 9), true);
  assert.equal(deveResumirVenda(venda(), consultora), true);
  assert.equal(deveResumirVenda(venda({ criado_por_id: 2, vendedora_id: 2, vendedoras: [{ id: 9, nome: 'Ana' }] }), consultora), true);
});

test('nao restringe aprovacao pendente, usuario nao vinculado, admin ou pos-venda', () => {
  assert.equal(deveResumirVenda(venda({ enviada_pos_venda_em: null }), consultora), false);
  assert.equal(deveResumirVenda(venda({ criado_por_id: 2, vendedora_id: 2, vendedoras: [{ id: 2 }] }), consultora), false);
  assert.equal(deveResumirVenda(venda(), { ...consultora, role: { nome: 'admin' } }), false);
  assert.equal(deveResumirVenda(venda(), { ...consultora, permissoes: { pos_venda: true } }), false);
});

test('guarda central responde 403 para canais detalhados da consultora', async () => {
  const vendaEnviada = venda();
  await assert.rejects(
    garantirAcessoCompletoVenda(vendaEnviada, consultora.id, { usuario: consultora }),
    error => error.statusCode === 403 && /apenas ao resumo/i.test(error.message)
  );

  assert.equal(
    await garantirAcessoCompletoVenda(vendaEnviada, consultora.id, {
      usuario: { ...consultora, permissoes: { pos_venda: true } }
    }),
    vendaEnviada
  );
});

test('monta DTO resumido com allowlist, chips, total, data efetiva e etapa final', async () => {
  const resumo = await montarResumoVenda(venda({
    razao_social: 'Empresa Teste Ltda',
    cnpj: '12345678000190',
    data_venda: null,
    criado_em: '2026-08-19 10:00:00',
    status_funil: 'finalizado',
    vendedoras: [{ id: 9, nome: 'Ana' }, { id: 10, nome: 'Bia' }],
    valores_unitarios_chips: JSON.stringify([{
      quantidade: 2,
      gb: '30',
      tipo_linha: 'portabilidade',
      operadora_atual_id: 1,
      operadora_id: 2,
      valor_unitario: '59,90'
    }]),
    telefone: '11999999999',
    senha: 'segredo'
  }), {
    etapaFinal: 'finalizado',
    operadorasPorId: new Map([[1, 'TIM'], [2, 'Claro']])
  });

  assert.deepEqual(Object.keys(resumo).sort(), [
    'chips', 'cnpj', 'concluida', 'data_venda', 'id', 'razao_social',
    'valor_total', 'vendedoras', 'visao_resumida_consultora'
  ].sort());
  assert.deepEqual(resumo.chips, [{
    quantidade: 2,
    gb: '30',
    tipo_linha: 'portabilidade',
    operadora_atual: 'TIM',
    operadora_destino: 'Claro',
    valor_unitario: 59.9,
    subtotal: 119.8
  }]);
  assert.equal(resumo.valor_total, 119.8);
  assert.equal(resumo.data_venda, '2026-08-19');
  assert.equal(resumo.concluida, true);
  assert.deepEqual(resumo.vendedoras, [{ nome: 'Ana' }, { nome: 'Bia' }]);
  assert.equal('telefone' in resumo, false);
  assert.equal('senha' in resumo, false);
});

test('sanitiza venda aninhada do fluxo de problemas para consultora restrita', () => {
  const problema = sanitizarProblema({
    id: 4,
    venda_id: 7,
    venda: venda({ telefone: '11999999999', senha: 'segredo' }),
    eventos: [{ id: 1, mensagem: 'Corrigir cadastro' }]
  }, consultora);

  assert.deepEqual(problema.venda, { id: 7, visao_resumida_consultora: true });
  assert.equal(problema.eventos[0].mensagem, 'Corrigir cadastro');
});

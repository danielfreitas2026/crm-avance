const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/services/lead-planilha.service');

const {
  obterErroReversaoFuturoCliente,
  montarPatchReversaoFuturoCliente
} = _internals;

test('permite reverter futuro cliente ativo ainda na sondagem', () => {
  const linha = {
    futuro_cliente: true,
    etapa_atual: 'sondagem',
    status_operacional: 'qualificado'
  };

  assert.equal(obterErroReversaoFuturoCliente(linha, false), null);
  assert.deepEqual(montarPatchReversaoFuturoCliente(linha), {
    futuro_cliente: false,
    status_operacional: 'pendente'
  });
});

test('mantem perdido quando a recusa do cliente continua ativa', () => {
  const patch = montarPatchReversaoFuturoCliente({ cliente_recusou: true });

  assert.deepEqual(patch, {
    futuro_cliente: false,
    status_operacional: 'perdido'
  });
});

test('mantem perdido quando uma venda recusada continua registrada', () => {
  const patch = montarPatchReversaoFuturoCliente({ venda_recusada_em: '2026-08-13 10:00:00' });

  assert.equal(patch.status_operacional, 'perdido');
});

test('o patch preserva os dados historicos da qualificacao', () => {
  const linha = {
    futuro_cliente: true,
    futuro_cliente_notas: 'Historico',
    futuro_cliente_retorno: '2026-08-20 10:00:00',
    futuro_cliente_marcado_em: '2026-08-13 09:00:00',
    futuro_cliente_marcado_por_id: 7,
    primeira_ligacao_avaliacao: 'bom'
  };
  const patch = montarPatchReversaoFuturoCliente(linha);

  assert.deepEqual(Object.keys(patch).sort(), ['futuro_cliente', 'status_operacional']);
});

test('bloqueia leads fora das condicoes administrativas permitidas', () => {
  const casos = [
    [{ futuro_cliente: false }, false, 400],
    [{ futuro_cliente: true, futuro_cliente_excluido_em: new Date() }, false, 409],
    [{ futuro_cliente: true, venda_id: 10 }, false, 409],
    [{ futuro_cliente: true, cliente_id: 10 }, false, 409],
    [{ futuro_cliente: true, status_operacional: 'vendido' }, false, 409],
    [{ futuro_cliente: true, etapa_atual: 'venda' }, false, 409],
    [{ futuro_cliente: true, status_operacional: 'distribuido_venda' }, false, 409],
    [{ futuro_cliente: true, etapa_atual: 'sondagem' }, true, 409]
  ];

  casos.forEach(([linha, possuiVendaPorCnpj, statusCode]) => {
    assert.equal(obterErroReversaoFuturoCliente(linha, possuiVendaPorCnpj)?.statusCode, statusCode);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const LeadPlanilha = require('../src/models/LeadPlanilha');
const leadPlanilhaService = require('../src/services/lead-planilha.service');

const { montarHistoricoDestinatariosPlanilha, situacaoEnvioHistorico } = leadPlanilhaService._internals;

test('agrupa o historico por pessoa e separa lotes de sondagem e venda', () => {
  const resultado = montarHistoricoDestinatariosPlanilha(
    { id: 7, nome: 'Agosto 24' },
    [
      {
        usuario_id: 12,
        usuario_id_historico: 12,
        usuario_nome: 'Ana',
        envio_id: 30,
        envio_nome: 'Primeiro envio',
        etapa: 'sondagem',
        envio_created_at: '2026-08-01 12:00:00',
        ultimo_atribuido_em: '2026-08-01 12:00:00',
        quantidade_recebida: 8,
        clientes_unicos: 8,
        quantidade_atual: 3
      },
      {
        usuario_id: 12,
        usuario_id_historico: 12,
        usuario_nome: 'Ana',
        envio_id: 31,
        envio_nome: 'Qualificados',
        etapa: 'venda',
        envio_created_at: '2026-08-05 12:00:00',
        ultimo_atribuido_em: '2026-08-05 12:00:00',
        quantidade_recebida: 2,
        clientes_unicos: 2,
        quantidade_atual: 2
      },
      {
        usuario_id: null,
        usuario_id_historico: 18,
        usuario_nome: 'Bruna',
        envio_id: 29,
        envio_nome: 'Envio cancelado',
        etapa: 'sondagem',
        envio_created_at: '2026-07-30 12:00:00',
        ultimo_atribuido_em: '2026-07-30 12:00:00',
        quantidade_recebida: 4,
        clientes_unicos: 4,
        quantidade_atual: 0
      }
    ],
    { clientes_unicos: 11, atualmente_atribuidos: 5 },
    [
      { usuario_id: 12, usuario_id_historico: 12, usuario_nome: 'Ana', clientes_unicos: 9, quantidade_atual: 5 },
      { usuario_id: null, usuario_id_historico: 18, usuario_nome: 'Bruna', clientes_unicos: 4, quantidade_atual: 0 }
    ]
  );

  assert.deepEqual(resultado.resumo, {
    pessoas: 2,
    atribuicoes: 14,
    clientes_unicos: 11,
    atualmente_atribuidos: 5
  });
  assert.equal(resultado.pessoas[0].usuario_nome, 'Ana');
  assert.equal(resultado.pessoas[0].clientes_unicos, 9);
  assert.equal(resultado.pessoas[0].envios[0].etapa, 'venda');
  assert.equal(resultado.pessoas[0].envios[1].situacao, 'parcial');
  assert.equal(resultado.pessoas[1].usuario_nome, 'Bruna');
  assert.equal(resultado.pessoas[1].usuario_excluido, true);
  assert.equal(resultado.pessoas[1].envios[0].situacao, 'encerrado');
});

test('classifica lotes atuais, parciais e encerrados', () => {
  assert.equal(situacaoEnvioHistorico(5, 5), 'atual');
  assert.equal(situacaoEnvioHistorico(5, 2), 'parcial');
  assert.equal(situacaoEnvioHistorico(5, 0), 'encerrado');
});

test('mantem pessoas excluidas distintas pelo identificador historico', () => {
  const resultado = montarHistoricoDestinatariosPlanilha({ id: 1, nome: 'Base' }, [
    { usuario_id: null, usuario_id_historico: 4, usuario_nome: 'Mesmo Nome', envio_id: 1, etapa: 'sondagem', quantidade_recebida: 1 },
    { usuario_id: null, usuario_id_historico: 5, usuario_nome: 'Mesmo Nome', envio_id: 1, etapa: 'sondagem', quantidade_recebida: 1 }
  ]);

  assert.equal(resultado.pessoas.length, 2);
});

test('historico responde 404 quando a planilha nao existe', async () => {
  const queryOriginal = LeadPlanilha.query;
  LeadPlanilha.query = () => ({
    findById: () => ({ select: async () => undefined })
  });

  try {
    await assert.rejects(
      leadPlanilhaService.listarHistoricoDestinatariosPlanilha(999),
      error => error.statusCode === 404 && error.message === 'Planilha nao encontrada.'
    );
  } finally {
    LeadPlanilha.query = queryOriginal;
  }
});

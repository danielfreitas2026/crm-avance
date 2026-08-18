/**
 * Servico de deteccao e notificacao de vendas paradas no funil.
 */
const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const db = require('../database/connection');
const { parseUtcDateTime } = require('../utils/datetime');
const { usuarioTemPermissaoLocal } = require('../utils/permissoes');
const {
  salvarNotificacaoIdempotente,
  desativarNotificacoesAtivas
} = require('./notificacao-persistencia.service');

const TIPO_NOTIFICACAO = 'venda_parada_funil';
const PERMISSAO_VENDAS_PARADAS = 'notificacoes_vendas_paradas';
const HORAS_LIMITE = 5 * 24; // 5 dias corridos em horas

/**
 * Verifica se usuario tem permissao atende a condicao esperada.
 */
function usuarioTemPermissao(usuario, permissao) {
  if (!usuario || !usuario.ativo) return false;
  return usuarioTemPermissaoLocal(usuario, permissao);
}

/**
 * Processa horas decorridas conforme as regras do dominio.
 */
function horasDecorridas(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) return 0;
  const inicio = parseUtcDateTime(dataInicio);
  const fim = parseUtcDateTime(dataFim);
  if (!inicio || !fim) return 0;
  return (fim - inicio) / (1000 * 60 * 60);
}

/**
 * Registra entrada estagio no historico ou log.
 */
async function registrarEntradaEstagio(vendaId, etapaCodigo, dataEntrada = new Date(), trx = null) {
  try {
    const executor = trx || db;
    const agora = new Date();

    await executor('venda_notificacao_parada')
      .insert({
        venda_id: vendaId,
        etapa_codigo: etapaCodigo,
        data_entrada_etapa: dataEntrada,
        created_at: agora,
        updated_at: agora
      })
      .onConflict(['venda_id', 'etapa_codigo'])
      .merge({
        data_entrada_etapa: dataEntrada,
        updated_at: agora
      });
  } catch (erro) {
    console.error('Erro ao registrar entrada no estágio:', erro);
  }
}

/**
 * Desativa notificacao venda parada quando nao e mais necessaria.
 */
async function desativarNotificacaoVendaParada(vendaId, etapaCodigo, trx = null) {
  try {
    const sourceKey = `${TIPO_NOTIFICACAO}:${vendaId}:${etapaCodigo}`;

    return desativarNotificacoesAtivas(
      Notificacao.query(trx).where('source_key', sourceKey)
    );
  } catch (erro) {
    console.error('Erro ao desativar notificação de venda parada:', erro);
  }
}

/**
 * Garante registros entrada ativos antes de continuar o fluxo.
 */
async function garantirRegistrosEntradaAtivos() {
  const vendasSemRegistro = await db('vendas as v')
    .join('funil_etapas as fe', 'v.status_funil', 'fe.codigo')
    .leftJoin('venda_notificacao_parada as vnp', function () {
      this.on('v.id', '=', 'vnp.venda_id')
        .andOn('v.status_funil', '=', 'vnp.etapa_codigo');
    })
    .where('fe.etapa_final', false)
    .where('v.excluido_em', null)
    .whereNull('vnp.id')
    .whereNotNull('v.status_funil')
    .select(
      'v.id',
      'v.status_funil',
      'v.ultima_atividade_em',
      'v.updated_at',
      'v.criado_em'
    );

  for (const venda of vendasSemRegistro) {
    const historicoEntrada = await db('venda_historicos')
      .where('venda_id', venda.id)
      .where('status_novo', venda.status_funil)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .first();

    await registrarEntradaEstagio(
      venda.id,
      venda.status_funil,
      historicoEntrada?.created_at || venda.ultima_atividade_em || venda.updated_at || venda.criado_em || new Date()
    );
  }
}

/**
 * Sincroniza vendas paradas com os dados atuais.
 */
async function sincronizarVendasParadas() {
  try {
    const agora = new Date();

    await garantirRegistrosEntradaAtivos();
    
    const vendas = await db('vendas as v')
      .join('venda_notificacao_parada as vnp', 'v.id', 'vnp.venda_id')
      .join('funil_etapas as fe', 'v.status_funil', 'fe.codigo')
      .where('fe.etapa_final', false)
      .where('v.excluido_em', null)
      .select(
        'v.id',
        'v.nome',
        'v.status_funil',
        'vnp.data_entrada_etapa',
        'v.vendedora_id',
        'fe.nome as etapa_nome',
        'fe.codigo as etapa_codigo'
      );

    for (const venda of vendas) {
      const horas = horasDecorridas(venda.data_entrada_etapa, agora);

      if (horas >= HORAS_LIMITE) {
        const dias = Math.floor(horas / 24);
        const sourceKey = `${TIPO_NOTIFICACAO}:${venda.id}:${venda.etapa_codigo}`;
        const dados = {
          venda_id: venda.id,
          venda_nome: venda.nome,
          etapa_codigo: venda.etapa_codigo,
          etapa_nome: venda.etapa_nome,
          horas: Math.floor(horas),
          data_entrada: venda.data_entrada_etapa
        };

        const payload = {
          tipo: TIPO_NOTIFICACAO,
          titulo: 'Venda parada no funil',
          mensagem: `A venda "${venda.nome}" está parada na etapa "${venda.etapa_nome}" há ${dias} ${dias === 1 ? 'dia' : 'dias'}.`,
          nivel: 'warn',
          entidade: 'vendas',
          entidade_id: venda.id,
          source_key: sourceKey,
          dados: JSON.stringify(dados),
          ativa: true
        };
        const destinatarios = await obterDestinatariosVenda(venda);
        await salvarNotificacaoIdempotente({
          sourceKeys: [sourceKey],
          sourceKeyNova: sourceKey,
          payload,
          destinatarios,
          agora,
          rearmarQuando: notificacao => Number(notificacao.ativa) !== 1
        });
      }
    }
  } catch (erro) {
    console.error('Erro ao sincronizar vendas paradas:', erro);
  }
}

/**
 * Obtem destinatarios venda a partir dos dados informados.
 */
async function obterDestinatariosVenda(venda) {
  try {
    const usuarios = await Usuario.query()
      .withGraphFetched('role')
      .where('ativo', true);

    const ids = new Set();

    usuarios.forEach(usuario => {
      if (usuarioTemPermissao(usuario, PERMISSAO_VENDAS_PARADAS)) {
        ids.add(Number(usuario.id));
      }
    });

    if (venda.vendedora_id) {
      const vendedora = usuarios.find(u => Number(u.id) === Number(venda.vendedora_id));
      if (usuarioTemPermissao(vendedora, PERMISSAO_VENDAS_PARADAS)) {
        ids.add(Number(venda.vendedora_id));
      }
    }

    return Array.from(ids);
  } catch (erro) {
    console.error('Erro ao obter destinatários da venda:', erro);
    return [];
  }
}

module.exports = {
  TIPO_NOTIFICACAO,
  PERMISSAO_VENDAS_PARADAS,
  HORAS_LIMITE,
  horasDecorridas,
  registrarEntradaEstagio,
  desativarNotificacaoVendaParada,
  sincronizarVendasParadas,
  obterDestinatariosVenda
};

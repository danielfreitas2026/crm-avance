const { Model } = require('objection');

/**
 * Modelo Objection para linhas importadas em planilhas de leads.
 */
class LeadLinha extends Model {
  static get tableName() {
    return 'lead_linhas';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['planilha_id', 'row_index', 'dados_json'],
      properties: {
        id: { type: 'integer' },
        planilha_id: { type: 'integer' },
        row_index: { type: 'integer' },
        dados_json: { type: ['object', 'string'] },
        local_ddds: { type: ['array', 'string', 'null'] },
        atribuido_para_id: { type: ['integer', 'null'] },
        envio_id: { type: ['integer', 'null'] },
        futuro_cliente: { type: ['boolean', 'integer'] },
        futuro_cliente_notas: { type: ['string', 'null'] },
        futuro_cliente_retorno: { type: ['string', 'object', 'null'] },
        futuro_cliente_retorno_realizado_em: { type: ['string', 'object', 'null'] },
        futuro_cliente_retorno_realizado_por_id: { type: ['integer', 'null'] },
        futuro_cliente_marcado_em: { type: ['string', 'object', 'null'] },
        futuro_cliente_marcado_por_id: { type: ['integer', 'null'] },
        futuro_cliente_destino: { type: ['string', 'null'], enum: ['carteira', 'distribuicao', null] },
        etapa_atual: { type: ['string', 'null'] },
        status_operacional: { type: ['string', 'null'] },
        cliente_id: { type: ['integer', 'null'] },
        venda_id: { type: ['integer', 'null'] },
        venda_registrada_oculta: { type: ['boolean', 'integer'] },
        venda_recusada_motivo: { type: ['string', 'null'] },
        venda_recusada_em: { type: ['string', 'object', 'null'] },
        venda_recusada_por_id: { type: ['integer', 'null'] },
        cliente_recusou: { type: ['boolean', 'integer'] },
        cliente_recusou_motivo: { type: ['string', 'null'] },
        cliente_recusou_em: { type: ['string', 'object', 'null'] },
        cliente_recusou_por_id: { type: ['integer', 'null'] },
        chamada_nao_atendida: { type: ['boolean', 'integer'] },
        chamada_nao_atendida_motivo: { type: ['string', 'null'] },
        chamada_nao_atendida_em: { type: ['string', 'object', 'null'] },
        chamada_nao_atendida_por_id: { type: ['integer', 'null'] },
        retorno_agendado_em: { type: ['string', 'object', 'null'] },
        retorno_agendado_observacao: { type: ['string', 'null'] },
        retorno_agendado_por_id: { type: ['integer', 'null'] },
        retorno_agendado_realizado_em: { type: ['string', 'object', 'null'] },
        retorno_agendado_realizado_por_id: { type: ['integer', 'null'] },
        primeira_ligacao_avaliacao: { type: ['string', 'null'] },
        primeira_ligacao_avaliada_por_id: { type: ['integer', 'null'] },
        primeira_ligacao_avaliada_em: { type: ['string', 'object', 'null'] },
        futuro_cliente_excluido_em: { type: ['string', 'object', 'null'] },
        futuro_cliente_excluir_definitivo_em: { type: ['string', 'object', 'null'] },
        futuro_cliente_excluido_por_id: { type: ['integer', 'null'] },
        created_at: { type: ['string', 'object'] },
        updated_at: { type: ['string', 'object'] }
      }
    };
  }

  // Sem esta lista, o Objection deduz as colunas JSON pelo jsonSchema e trata como JSON
  // toda coluna cujo type aceita 'object' — inclusive as de data, que iriam para o banco
  // com aspas e virariam 0000-00-00 no MySQL.
  static get jsonAttributes() {
    return ['dados_json', 'local_ddds'];
  }

  static get relationMappings() {
    const LeadPlanilha = require('./LeadPlanilha');
    const LeadEnvio = require('./LeadEnvio');
    const Usuario = require('./Usuario');
    const LeadSondagem = require('./LeadSondagem');
    const LeadEnriquecimento = require('./LeadEnriquecimento');

    return {
      planilha: {
        relation: Model.BelongsToOneRelation,
        modelClass: LeadPlanilha,
        join: {
          from: 'lead_linhas.planilha_id',
          to: 'lead_planilhas.id'
        }
      },
      envio: {
        relation: Model.BelongsToOneRelation,
        modelClass: LeadEnvio,
        join: {
          from: 'lead_linhas.envio_id',
          to: 'lead_envios.id'
        }
      },
      atribuidoPara: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'lead_linhas.atribuido_para_id',
          to: 'usuarios.id'
        }
      },
      sondagem: {
        relation: Model.HasOneRelation,
        modelClass: LeadSondagem,
        join: {
          from: 'lead_linhas.id',
          to: 'lead_sondagens.lead_linha_id'
        }
      },
      enriquecimento: {
        relation: Model.HasOneRelation,
        modelClass: LeadEnriquecimento,
        join: {
          from: 'lead_linhas.id',
          to: 'lead_enriquecimento.lead_linha_id'
        }
      },
      futuroClienteExcluidoPor: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'lead_linhas.futuro_cliente_excluido_por_id',
          to: 'usuarios.id'
        }
      },
      futuroClienteMarcadoPor: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'lead_linhas.futuro_cliente_marcado_por_id',
          to: 'usuarios.id'
        }
      }
    };
  }
}

module.exports = LeadLinha;

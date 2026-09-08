const { Model } = require('objection');

/**
 * Modelo Objection para o historico de alteracoes de vendas.
 */
class VendaHistorico extends Model {
  static get tableName() {
    return 'venda_historicos';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['venda_id', 'acao'],
      properties: {
        id: { type: 'integer' },
        venda_id: { type: 'integer' },
        usuario_id: { type: ['integer', 'null'] },
        acao: { type: 'string', minLength: 1, maxLength: 120 },
        status_anterior: { type: ['string', 'null'], maxLength: 40 },
        status_novo: { type: ['string', 'null'], maxLength: 40 },
        observacao: { type: ['string', 'null'] },
        dados: { type: ['object', 'array', 'string', 'null'] },
        created_at: { type: 'string' },
        deleted_at: { type: ['string', 'null'] },
        deleted_by_id: { type: ['integer', 'null'] },
        deleted_reason: { type: ['string', 'null'], maxLength: 1000 },
        invalidated_at: { type: ['string', 'null'] },
        invalidated_by_id: { type: ['integer', 'null'] },
        invalidation_reason: { type: ['string', 'null'] },
        correction_automation_id: { type: ['integer', 'null'] }
      }
    };
  }

  static get relationMappings() {
    const Usuario = require('./Usuario');
    const Venda = require('./Venda');

    return {
      usuario: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'venda_historicos.usuario_id',
          to: 'usuarios.id'
        }
      },
      excluidoPor: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'venda_historicos.deleted_by_id',
          to: 'usuarios.id'
        }
      },
      venda: {
        relation: Model.BelongsToOneRelation,
        modelClass: Venda,
        join: {
          from: 'venda_historicos.venda_id',
          to: 'vendas.id'
        }
      }
    };
  }
}

module.exports = VendaHistorico;

const { Model } = require('objection');

/**
 * Modelo Objection para planilhas de leads importadas.
 */
class LeadPlanilha extends Model {
  static get tableName() {
    return 'lead_planilhas';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['nome', 'colunas', 'schema_colunas'],
      properties: {
        id: { type: 'integer' },
        nome: { type: 'string', minLength: 1, maxLength: 240 },
        colunas: { type: ['array', 'string'] },
        schema_colunas: { type: ['object', 'string'] },
        local_config: { type: ['object', 'string', 'null'] },
        total_linhas: { type: 'integer' },
        criado_por_id: { type: ['integer', 'null'] },
        created_at: { type: ['string', 'object'] },
        updated_at: { type: ['string', 'object'] }
      }
    };
  }

  static get relationMappings() {
    const Usuario = require('./Usuario');
    const LeadLinha = require('./LeadLinha');

    return {
      criador: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'lead_planilhas.criado_por_id',
          to: 'usuarios.id'
        }
      },
      linhas: {
        relation: Model.HasManyRelation,
        modelClass: LeadLinha,
        join: {
          from: 'lead_planilhas.id',
          to: 'lead_linhas.planilha_id'
        }
      }
    };
  }
}

module.exports = LeadPlanilha;

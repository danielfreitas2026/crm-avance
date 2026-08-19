const { Model } = require('objection');

/**
 * Modelo Objection para lotes de distribuicao de leads.
 */
class LeadEnvio extends Model {
  static get tableName() {
    return 'lead_envios';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['nome'],
      properties: {
        id: { type: 'integer' },
        nome: { type: 'string', minLength: 1, maxLength: 240 },
        origem: { type: 'string', enum: ['mailing', 'futuro_cliente_telegram'] },
        total_linhas: { type: 'integer' },
        colunas_visiveis: { type: ['array', 'string', 'null'] },
        criado_por_id: { type: ['integer', 'null'] },
        created_at: { type: ['string', 'object'] },
        updated_at: { type: ['string', 'object'] }
      }
    };
  }

  static get relationMappings() {
    const Usuario = require('./Usuario');
    const LeadEnvioUsuario = require('./LeadEnvioUsuario');

    return {
      criador: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'lead_envios.criado_por_id',
          to: 'usuarios.id'
        }
      },
      usuarios: {
        relation: Model.HasManyRelation,
        modelClass: LeadEnvioUsuario,
        join: {
          from: 'lead_envios.id',
          to: 'lead_envio_usuarios.envio_id'
        }
      }
    };
  }
}

module.exports = LeadEnvio;

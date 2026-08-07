const { Model } = require('objection');

/**
 * Resultado do enriquecimento automatico de contatos de uma linha do mailing.
 * Ver migration create_lead_enriquecimento.
 */
class LeadEnriquecimento extends Model {
  static get tableName() {
    return 'lead_enriquecimento';
  }

  static get jsonAttributes() {
    // contatos_json e guardado como texto e desserializado no service.
    return [];
  }

  static get relationMappings() {
    const LeadLinha = require('./LeadLinha');

    return {
      linha: {
        relation: Model.BelongsToOneRelation,
        modelClass: LeadLinha,
        join: {
          from: 'lead_enriquecimento.lead_linha_id',
          to: 'lead_linhas.id'
        }
      }
    };
  }
}

module.exports = LeadEnriquecimento;

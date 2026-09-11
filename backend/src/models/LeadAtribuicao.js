const { Model } = require('objection');

class LeadAtribuicao extends Model {
  static get tableName() { return 'lead_atribuicoes'; }

  static get jsonSchema() {
    return {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        lead_linha_id: { type: 'integer' },
        envio_id: { type: ['integer', 'null'] },
        usuario_id: { type: ['integer', 'null'] },
        usuario_id_historico: { type: ['integer', 'null'] },
        usuario_nome_historico: { type: ['string', 'null'], maxLength: 120 }
      }
    };
  }
}

module.exports = LeadAtribuicao;


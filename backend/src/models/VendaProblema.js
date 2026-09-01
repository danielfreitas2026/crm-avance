const { Model } = require('objection');

/**
 * Modelo Objection para problemas apontados em vendas.
 */
class VendaProblema extends Model {
  static get tableName() {
    return 'venda_problemas';
  }

  static get idColumn() {
    return 'id';
  }

  static get relationMappings() {
    const Venda = require('./Venda');
    const Usuario = require('./Usuario');
    const VendaProblemaDestinatario = require('./VendaProblemaDestinatario');
    const VendaProblemaEvento = require('./VendaProblemaEvento');

    return {
      venda: {
        relation: Model.BelongsToOneRelation,
        modelClass: Venda,
        join: {
          from: 'venda_problemas.venda_id',
          to: 'vendas.id'
        }
      },
      solicitante: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'venda_problemas.solicitante_id',
          to: 'usuarios.id'
        }
      },
      resolvidoPor: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'venda_problemas.resolvido_por_id',
          to: 'usuarios.id'
        }
      },
      destinatarios: {
        relation: Model.HasManyRelation,
        modelClass: VendaProblemaDestinatario,
        join: {
          from: 'venda_problemas.id',
          to: 'venda_problema_destinatarios.problema_id'
        }
      },
      eventos: {
        relation: Model.HasManyRelation,
        modelClass: VendaProblemaEvento,
        join: {
          from: 'venda_problemas.id',
          to: 'venda_problema_eventos.problema_id'
        }
      }
    };
  }
}

module.exports = VendaProblema;

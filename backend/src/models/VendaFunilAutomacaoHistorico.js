const { Model } = require('objection');

/** Historico exclusivo do funil comparativo de automacoes. */
class VendaFunilAutomacaoHistorico extends Model {
  static get tableName() {
    return 'venda_funil_automacao_historicos';
  }

  static get relationMappings() {
    const Usuario = require('./Usuario');
    return {
      usuario: {
        relation: Model.BelongsToOneRelation,
        modelClass: Usuario,
        join: {
          from: 'venda_funil_automacao_historicos.usuario_id',
          to: 'usuarios.id'
        }
      }
    };
  }
}

module.exports = VendaFunilAutomacaoHistorico;

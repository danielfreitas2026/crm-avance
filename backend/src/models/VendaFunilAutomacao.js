const { Model } = require('objection');

/** Estado comparativo da venda movimentado pela automacao de e-mails. */
class VendaFunilAutomacao extends Model {
  static get tableName() {
    return 'venda_funil_automacoes';
  }

  static get idColumn() {
    return 'venda_id';
  }
}

module.exports = VendaFunilAutomacao;

const { Model } = require('objection');

class AutomacaoEmail extends Model {
  static get tableName() { return 'automacao_emails'; }
  static get idColumn() { return 'id'; }
}

module.exports = AutomacaoEmail;

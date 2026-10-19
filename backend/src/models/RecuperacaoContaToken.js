const { Model } = require('objection');

class RecuperacaoContaToken extends Model {
  static get tableName() {
    return 'recuperacao_conta_tokens';
  }
}

module.exports = RecuperacaoContaToken;

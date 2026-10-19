const { Model } = require('objection');

/**
 * Modelo Objection para usuarios do sistema.
 */
class Usuario extends Model {
  static get tableName() {
    return 'usuarios';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['nome', 'email', 'senha', 'role_id'],

      properties: {
        id: { type: 'integer' },
        nome: { type: 'string', minLength: 1, maxLength: 120 },
        email: { type: 'string', minLength: 1, maxLength: 160 },
        senha: { type: 'string', minLength: 1, maxLength: 255 },
        senha_criptografada: { type: ['string', 'null'] },
        email_recuperacao: { type: ['string', 'null'], maxLength: 254 },
        email_recuperacao_pendente: { type: ['string', 'null'], maxLength: 254 },
        email_recuperacao_confirmado_em: { type: ['string', 'null'] },
        versao_sessao: { type: 'integer', minimum: 0 },
        foto_perfil: { type: ['string', 'null'] },
        role_id: { type: 'integer' },
        permissoes: { type: ['array', 'string', 'null'] },
        ativo: { type: ['boolean', 'integer'] },
        created_at: { type: ['string', 'object'] },
        updated_at: { type: ['string', 'object'] }
      }
    };
  }

  static get relationMappings() {
    const Role = require('./Role');

    return {
      role: {
        relation: Model.BelongsToOneRelation,
        modelClass: Role,
        join: {
          from: 'usuarios.role_id',
          to: 'roles.id'
        }
      }
    };
  }

  estaAtivo() {
    return this.ativo === true || this.ativo === 1;
  }

  $formatJson(json) {
    json = super.$formatJson(json);

    delete json.senha;
    delete json.senha_criptografada;
    delete json.email_recuperacao;
    delete json.email_recuperacao_pendente;
    delete json.email_recuperacao_confirmado_em;
    delete json.versao_sessao;

    return json;
  }
}


module.exports = Usuario;

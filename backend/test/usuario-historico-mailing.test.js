const test = require('node:test');
const assert = require('node:assert/strict');

const Usuario = require('../src/models/Usuario');
const usuarioService = require('../src/services/usuario.service');

test('exclusao preserva a identidade nas atribuicoes antes de remover o usuario', async () => {
  const transactionOriginal = Usuario.transaction;
  const queryOriginal = Usuario.query;
  const eventos = [];
  const trx = () => ({
    where(campo, valor) {
      eventos.push(['where', campo, valor]);
      return this;
    },
    async update(patch) {
      eventos.push(['snapshot', patch]);
      return 2;
    }
  });
  Usuario.transaction = async callback => callback(trx);
  Usuario.query = () => ({
    findById(id) {
      assert.equal(id, 14);
      return { select: async () => ({ id: 14, nome: 'Consultora removida' }) };
    },
    async deleteById(id) {
      eventos.push(['delete', id]);
      return 1;
    }
  });

  try {
    assert.equal(await usuarioService.excluirUsuario(14), 1);
    assert.deepEqual(eventos, [
      ['where', 'usuario_id', 14],
      ['snapshot', { usuario_id_historico: 14, usuario_nome_historico: 'Consultora removida' }],
      ['delete', 14]
    ]);
  } finally {
    Usuario.transaction = transactionOriginal;
    Usuario.query = queryOriginal;
  }
});

const { prepararCriacaoRecebida, impedirRollback } = require('../migration-utils/conciliar-senha-usuarios');

// Libera o nome da coluna antes da segunda criacao, preservando os valores.
exports.up = prepararCriacaoRecebida;
exports.down = impedirRollback;

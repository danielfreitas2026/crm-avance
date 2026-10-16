const { restaurar, impedirRollback } = require('../migration-utils/conciliar-senha-usuarios');

// Reestabelece o contrato escolhido apos a migration local de remocao.
exports.up = restaurar;
exports.down = impedirRollback;

const { reservar, impedirRollback } = require('../migration-utils/conciliar-senha-usuarios');

// Precede a criacao local, inclusive em bancos com a versao recebida instalada.
exports.up = reservar;
exports.down = impedirRollback;

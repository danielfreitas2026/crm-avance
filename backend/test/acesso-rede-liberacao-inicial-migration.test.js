const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const migration = require('../src/database/migrations/20261021121000_grant_initial_acesso_rede_sem_codigo');
const db = require('../src/config/database');
const Usuario = require('../src/models/Usuario');
const horario = require('../src/services/horario-acesso.service');
const rede = require('../src/services/acesso-rede.service');
const authMiddleware = require('../src/middlewares/auth.middleware');

function banco(usuarios, falharNoId) {
  let estado = structuredClone(usuarios);
  const consultas = [];
  let transacoes = 0;
  const knex = {
    async transaction(callback) {
      transacoes++;
      const copia = structuredClone(estado);
      const trx = tabela => {
        assert.equal(tabela, 'usuarios', 'a migration não deve alterar perfis, horários ou configurações');
        let id, bloqueado = false;
        return {
          select(...campos) { assert.deepEqual(campos, ['id', 'permissoes']); return this; },
          orderBy(campo, direcao) { assert.equal(campo, 'id'); assert.equal(direcao, 'asc'); return this; },
          forUpdate() { bloqueado = true; consultas.push('bloqueio'); return this; },
          where(filtro) { assert.deepEqual(Object.keys(filtro), ['id']); id = filtro.id; return this; },
          async update(dados) {
            assert.deepEqual(Object.keys(dados), ['permissoes']);
            consultas.push(`atualizacao:${id}`);
            if (id === falharNoId) throw new Error('Falha de persistência simulada.');
            Object.assign(copia.find(row => row.id === id), dados);
          },
          then(resolve, reject) {
            assert.equal(bloqueado, true, 'a leitura deve bloquear as linhas antes de alterar permissões');
            return Promise.resolve(copia.map(({ id, permissoes }) => ({ id, permissoes }))).then(resolve, reject);
          }
        };
      };
      await callback(trx);
      estado = copia;
    }
  };
  return { knex, get usuarios() { return estado; }, consultas, get transacoes() { return transacoes; } };
}

test('migration libera todas as contas, preservando listas, mapas, campos vazios e demais dados', async () => {
  const valores = [
    ['clientes_ver'], '["vendas","acesso_rede_sem_codigo"]',
    { vendas: true, clientes_excluir: false, acesso_rede_sem_codigo: false },
    '{"vendas":true,"configurar_acesso_rede":false}',
    null, '', 'null', '[]', '{}'
  ];
  const usuarios = valores.map((permissoes, indice) => ({ id: indice + 1, permissoes,
    nome: `Usuário ${indice}`, ativo: indice % 2 === 0, role_id: 2, versao_sessao: 3 }));
  const b = banco(usuarios);
  await migration.up(b.knex);
  assert.equal(b.transacoes, 1);
  assert.equal(b.consultas[0], 'bloqueio');
  for (let i = 0; i < usuarios.length; i++) {
    const { permissoes: anterior, ...outrosAntes } = usuarios[i];
    const { permissoes: atual, ...outrosDepois } = b.usuarios[i];
    assert.deepEqual(outrosDepois, outrosAntes);
    let esperado = typeof anterior === 'string' && anterior ? JSON.parse(anterior) : anterior;
    const depois = JSON.parse(atual);
    if (esperado == null || esperado === '') esperado = [];
    if (Array.isArray(esperado)) {
      assert.deepEqual(depois, esperado.includes('acesso_rede_sem_codigo') ? esperado : [...esperado, 'acesso_rede_sem_codigo']);
      assert.equal(depois.includes('configurar_acesso_rede'), false);
    } else {
      assert.deepEqual(depois, { ...esperado, acesso_rede_sem_codigo: true });
      assert.notEqual(depois.configurar_acesso_rede, true);
    }
  }
});

test('falha de persistência ou permissão ilegível desfaz a concessão inteira sem apagar dados', async () => {
  const usuarios = [{ id: 1, permissoes: '["vendas"]' }, { id: 2, permissoes: '{"clientes_excluir":false}' }];
  const falha = banco(usuarios, 2);
  await assert.rejects(migration.up(falha.knex), /persistência simulada/);
  assert.deepEqual(falha.usuarios, usuarios);
  for (const invalido of ['json inválido', 'true', '123']) {
    const dados = [usuarios[0], { id: 2, permissoes: invalido }];
    const b = banco(dados);
    await assert.rejects(migration.up(b.knex), /Permissões inválidas no usuário 2/);
    assert.deepEqual(b.usuarios, dados);
  }
});

test('concessão libera sessão externa com trava ativa sem ignorar conta inativa ou horário fechado', async t => {
  const b = banco([{ id: 1, ativo: true, role_id: 2, permissoes: '[]' }]);
  await migration.up(b.knex);
  const usuario = { ...b.usuarios[0], versao_sessao: 0, role: { nome: 'usuario', permissoes: '[]' } };
  t.mock.method(db.client, 'acquireConnection', async () => ({}));
  t.mock.method(db.client, 'releaseConnection', async () => {});
  t.mock.method(db.client, '_query', async (_conexao, consulta) => {
    assert.match(consulta.sql, /from `configuracoes_acesso_rede`/);
    return { ...consulta, response: [[{ id: 1, ativo: true, redes: '["203.0.113.10"]' }], []] };
  });
  t.mock.method(Usuario, 'query', () => ({ findById() { return this; }, withGraphFetched: async () => usuario }));
  let acesso = { permitido: true, versao_sessao: 0 };
  t.mock.method(horario, 'avaliarAcesso', async () => acesso);
  t.mock.method(db, 'transaction', async () => assert.fail('usuário dispensado não deve gerar nem consumir código'));
  const token = jwt.sign({ id: 1, versao_sessao: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const req = { ip: '198.51.100.20', headers: { authorization: `Bearer ${token}` } };
  let passou = false;
  const res = { status(codigo) { this.statusCode = codigo; return this; }, json(dados) { this.body = dados; return this; } };
  await authMiddleware(req, res, () => { passou = true; });
  assert.equal(passou, true);
  acesso = { permitido: false, motivo: 'USUARIO_INATIVO', versao_sessao: 0 };
  await authMiddleware(req, res, () => assert.fail('conta inativa não pode entrar'));
  assert.equal(res.statusCode, 401);
  acesso = { permitido: false, motivo: 'SYSTEM_CLOSED', versao_sessao: 0 };
  await authMiddleware(req, res, () => assert.fail('dispensa de rede não ignora horário'));
  assert.equal(res.statusCode, 423);
  assert.equal(res.body.code, 'SYSTEM_CLOSED');
});

test('remoção manual continua efetiva e rollback não revoga nem restaura dispensas', async () => {
  const b = banco([{ id: 1, ativo: true, permissoes: '[]' }, { id: 2, ativo: false, permissoes: '[]' }]);
  await migration.up(b.knex);
  const role = { nome: 'usuario', permissoes: '[]' };
  assert.equal(rede.dispensado({ ...b.usuarios[0], role }), true);
  assert.equal(rede.dispensado({ ...b.usuarios[1], role }), false);
  b.usuarios[0].permissoes = '[]';
  const depoisDaEdicao = structuredClone(b.usuarios);
  await migration.down(b.knex);
  assert.deepEqual(b.usuarios, depoisDaEdicao);
  assert.equal(rede.dispensado({ ...b.usuarios[0], role }), false);
  assert.deepEqual(JSON.parse(b.usuarios[1].permissoes), ['acesso_rede_sem_codigo']);
});

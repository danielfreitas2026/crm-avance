const test = require('node:test');
const assert = require('node:assert/strict');

const vendaService = require('../src/services/venda.service');
const configService = require('../src/services/config.service');
const Venda = require('../src/models/Venda');
const FunilEtapa = require('../src/models/FunilEtapa');
const Usuario = require('../src/models/Usuario');

const { validarAceiteBiometria } = vendaService._internals;

const ETAPAS = [
  { id: 'aprovacao', ordem: 1, aceite_biometria: false },
  { id: 'aceite', ordem: 2, aceite_biometria: true },
  { id: 'ativacao', ordem: 3, aceite_biometria: false }
];

test('bloqueia somente o avanco com marcadores pendentes', async () => {
  const venda = {
    status_funil: 'aceite',
    aceite_concluido: false,
    biometria_concluida: false,
    operadora: { nome: 'Claro' }
  };

  assert.equal(
    await validarAceiteBiometria(venda, 'ativacao', ETAPAS),
    'Conclua Aceite e Biometria antes de avançar para outra etapa.'
  );
  assert.equal(await validarAceiteBiometria({ ...venda, aceite_concluido: true }, 'ativacao', ETAPAS), 'Conclua Biometria antes de avançar para outra etapa.');
  assert.equal(await validarAceiteBiometria({ ...venda, aceite_concluido: true, biometria_concluida: true }, 'ativacao', ETAPAS), null);
  assert.equal(await validarAceiteBiometria(venda, 'aceite', ETAPAS), null);
  assert.equal(await validarAceiteBiometria(venda, 'aprovacao', ETAPAS), null);
  assert.equal(await validarAceiteBiometria(venda, 'retorno', ETAPAS), null);
});

test('exige somente aceite para vendas nao Claro', async () => {
  for (const operadora of [{ nome: 'Vivo' }, { nome: 'TIM' }, null]) {
    const venda = {
      status_funil: 'aceite',
      aceite_concluido: false,
      biometria_concluida: false,
      operadora
    };

    assert.equal(
      await validarAceiteBiometria(venda, 'ativacao', ETAPAS),
      'Conclua Aceite antes de avançar para outra etapa.'
    );
    assert.equal(
      await validarAceiteBiometria({ ...venda, aceite_concluido: true }, 'ativacao', ETAPAS),
      null
    );
  }
});

function mockAdmin() {
  const original = Usuario.query;
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched() {
      return Promise.resolve({ id: 7, ativo: true, role: { nome: 'admin' }, permissoes: {} });
    }
  });
  return () => { Usuario.query = original; };
}

function mockUsuarioSemAcesso() {
  const original = Usuario.query;
  Usuario.query = () => ({
    findById() { return this; },
    withGraphFetched() {
      return Promise.resolve({ id: 8, ativo: true, role: { nome: 'usuario', permissoes: {} }, permissoes: {} });
    }
  });
  return () => { Usuario.query = original; };
}

function resultadoQueryVenda(venda) {
  return {
    withGraphFetched: async () => venda,
    then(resolve, reject) {
      return Promise.resolve(venda).then(resolve, reject);
    }
  };
}

test('altera somente o marcador solicitado quando a venda esta na etapa configurada', async () => {
  const restaurarUsuario = mockAdmin();
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const venda = {
    id: 12,
    status_funil: 'aceite',
    aceite_concluido: false,
    biometria_concluida: false,
    excluido_em: null,
    cancelada_em: null,
    operadora: { nome: 'Claro' }
  };
  let patch = null;

  Venda.query = () => ({
    findById: () => resultadoQueryVenda(venda),
    where(filtros) {
      assert.deepEqual(filtros, { id: 12, status_funil: 'aceite' });
      return this;
    },
    whereNull() { return this; },
    patch: async dados => {
      patch = dados;
      Object.assign(venda, dados);
      return 1;
    }
  });
  FunilEtapa.query = () => ({
    findOne() { return this; },
    select: async () => ({ id: 2, aceite_biometria: true })
  });

  try {
    const resultado = await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'aceite', concluido: true }, 7);
    assert.equal(resultado.status, 'ok');
    assert.equal(patch.aceite_concluido, true);
    assert.equal(Object.hasOwn(patch, 'biometria_concluida'), false);
    assert.equal(typeof patch.updated_at, 'string');
  } finally {
    restaurarUsuario();
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
  }
});

test('rejeita alteracao de biometria para venda nao Claro', async () => {
  const restaurarUsuario = mockAdmin();
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;
  const venda = {
    id: 12,
    status_funil: 'aceite',
    aceite_concluido: false,
    biometria_concluida: false,
    excluido_em: null,
    cancelada_em: null,
    operadora: { nome: 'Vivo' }
  };
  let alterouVenda = false;

  Venda.query = () => ({
    findById: () => resultadoQueryVenda(venda),
    where() { return this; },
    whereNull() { return this; },
    patch: async () => {
      alterouVenda = true;
      return 1;
    }
  });
  FunilEtapa.query = () => ({
    findOne() { return this; },
    select: async () => ({ id: 2, aceite_biometria: true })
  });

  try {
    const resultado = await vendaService.atualizarAceiteBiometriaVenda(
      12,
      { marcador: 'biometria', concluido: true },
      7
    );

    assert.equal(resultado.status, 'invalid');
    assert.equal(alterouVenda, false);
  } finally {
    restaurarUsuario();
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
  }
});

test('rejeita payload invalido, venda cancelada e etapa sem a marcacao', async () => {
  const restaurarUsuario = mockAdmin();
  const queryVendaOriginal = Venda.query;
  const queryEtapaOriginal = FunilEtapa.query;

  try {
    assert.equal((await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'outro', concluido: true }, 7)).status, 'invalid');

    Venda.query = () => ({ findById: () => resultadoQueryVenda({ id: 12, status_funil: 'aceite', cancelada_em: '2026-08-28', excluido_em: null }) });
    assert.equal((await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'aceite', concluido: true }, 7)).status, 'invalid');

    Venda.query = () => ({ findById: () => resultadoQueryVenda({ id: 12, status_funil: 'aceite', cancelada_em: null, excluido_em: null }) });
    FunilEtapa.query = () => ({ findOne() { return this; }, select: async () => ({ id: 2, aceite_biometria: false }) });
    assert.equal((await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'biometria', concluido: true }, 7)).status, 'invalid');
  } finally {
    restaurarUsuario();
    Venda.query = queryVendaOriginal;
    FunilEtapa.query = queryEtapaOriginal;
  }
});

test('nao altera venda fora do escopo ou excluida', async () => {
  const queryVendaOriginal = Venda.query;
  const restaurarSemAcesso = mockUsuarioSemAcesso();
  let consultouVenda = false;
  Venda.query = () => {
    consultouVenda = true;
    return {};
  };

  try {
    const semAcesso = await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'aceite', concluido: true }, 8);
    assert.equal(semAcesso.status, 'not_found');
    assert.equal(consultouVenda, false);
  } finally {
    restaurarSemAcesso();
    Venda.query = queryVendaOriginal;
  }

  const restaurarAdmin = mockAdmin();
  Venda.query = () => ({ findById: () => resultadoQueryVenda({ id: 12, excluido_em: '2026-08-28 10:00:00' }) });
  try {
    const excluida = await vendaService.atualizarAceiteBiometriaVenda(12, { marcador: 'aceite', concluido: true }, 7);
    assert.equal(excluida.status, 'not_found');
  } finally {
    restaurarAdmin();
    Venda.query = queryVendaOriginal;
  }
});

test('configuracao cria e atualiza a marcacao da etapa', async () => {
  const queryOriginal = FunilEtapa.query;
  const gravacoes = [];
  let consulta = 0;
  FunilEtapa.query = () => {
    consulta += 1;
    if (consulta === 1) return { findOne: async () => null };
    if (consulta === 2) return { insert: async dados => { gravacoes.push(dados); return dados; } };
    return { patchAndFetchById: async (id, dados) => { gravacoes.push({ id, ...dados }); return dados; } };
  };

  try {
    await configService.criarFunilEtapa({ nome: 'Aceite', aceite_biometria: true });
    await configService.atualizarFunilEtapa(9, { aceite_biometria: false });
    assert.equal(gravacoes[0].aceite_biometria, true);
    assert.deepEqual(gravacoes[1], { id: 9, aceite_biometria: false });
  } finally {
    FunilEtapa.query = queryOriginal;
  }
});

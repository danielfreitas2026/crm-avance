const PERMISSAO = {
  chave: 'vendas_ver_completa_apos_envio',
  nome: 'Ver venda completa após envio',
  descricao: 'Libera o formulário completo, notas, documentos, reversões e exportações detalhadas de vendas enviadas ao pós-venda.'
};

function parsePermissoes(valor) {
  if (!valor) return {};
  if (typeof valor === 'string') {
    try { return parsePermissoes(JSON.parse(valor)); } catch { return {}; }
  }
  if (Array.isArray(valor)) return valor.reduce((acc, chave) => ({ ...acc, [chave]: true }), {});
  if (typeof valor === 'object') return { ...valor };
  return {};
}

exports.up = async function up(knex) {
  const existente = await knex('permissoes').where('chave', PERMISSAO.chave).first();
  if (existente) {
    await knex('permissoes').where('id', existente.id).update({ ...PERMISSAO, ativo: true });
    return;
  }

  await knex('permissoes').insert({ ...PERMISSAO, ativo: true });
};

exports.down = async function down(knex) {
  for (const tabela of ['roles', 'usuarios']) {
    const registros = await knex(tabela).select('id', 'permissoes');
    for (const registro of registros) {
      const permissoes = parsePermissoes(registro.permissoes);
      if (!Object.prototype.hasOwnProperty.call(permissoes, PERMISSAO.chave)) continue;
      delete permissoes[PERMISSAO.chave];
      await knex(tabela).where('id', registro.id).update({ permissoes: JSON.stringify(permissoes) });
    }
  }

  await knex('permissoes').where('chave', PERMISSAO.chave).delete();
};

exports._internals = { PERMISSAO, parsePermissoes };

const ACAO_REVERSAO = 'venda.reversao_registrada';
const DATA_ZERO = '0000-00-00 00:00:00';

function parseJsonRecursivo(valor) {
  let atual = valor;
  for (let tentativa = 0; tentativa < 3 && typeof atual === 'string'; tentativa += 1) {
    try {
      atual = JSON.parse(atual);
    } catch {
      break;
    }
  }
  return atual && typeof atual === 'object' ? atual : {};
}

function formatarUtcSql(valorSaoPaulo) {
  if (!valorSaoPaulo || valorSaoPaulo === DATA_ZERO) return null;
  const normalizado = String(valorSaoPaulo).replace(' ', 'T');
  const data = new Date(`${normalizado}-03:00`);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 19).replace('T', ' ');
}

exports.up = async function (knex) {
  const reversoesSemData = await knex('venda_historicos')
    .where({ acao: ACAO_REVERSAO, created_at: DATA_ZERO })
    .select('id', 'venda_id', 'observacao')
    .orderBy('id', 'asc');

  if (reversoesSemData.length === 0) return;

  const vendaIds = [...new Set(reversoesSemData.map(item => String(item.venda_id)))];
  const auditorias = await knex('audit_logs')
    .where({ acao: ACAO_REVERSAO, entidade: 'vendas' })
    .whereIn('entidade_id', vendaIds)
    .select('id', 'entidade_id', 'dados', 'created_at')
    .orderBy('id', 'asc');

  const auditoriasUsadas = new Set();
  for (const reversao of reversoesSemData) {
    const auditoria = auditorias.find(item => {
      if (auditoriasUsadas.has(item.id) || String(item.entidade_id) !== String(reversao.venda_id)) return false;
      const dados = parseJsonRecursivo(item.dados);
      return String(dados.observacao || '').trim() === String(reversao.observacao || '').trim();
    }) || auditorias.find(item => (
      !auditoriasUsadas.has(item.id) && String(item.entidade_id) === String(reversao.venda_id)
    ));

    const createdAt = formatarUtcSql(auditoria?.created_at);
    if (!auditoria || !createdAt) continue;

    await knex('venda_historicos').where({ id: reversao.id }).update({ created_at: createdAt });
    auditoriasUsadas.add(auditoria.id);
  }
};

exports.down = async function () {
  // Correção de dados históricos: não há restauração segura para uma data zero.
};

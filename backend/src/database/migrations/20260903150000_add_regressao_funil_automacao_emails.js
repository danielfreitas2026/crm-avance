const ERRO_REGRESSAO_FUNIL = 'O e-mail tentaria regredir o funil.';

const ENUM_COM_REGRESSAO = "ENUM('pendente', 'processando', 'concluido', 'revisao', 'regressao_funil', 'erro', 'rejeitado', 'descartado') NOT NULL DEFAULT 'pendente'";
const ENUM_ANTERIOR = "ENUM('pendente', 'processando', 'concluido', 'revisao', 'erro', 'rejeitado', 'descartado') NOT NULL DEFAULT 'pendente'";

exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE automacao_emails MODIFY status ${ENUM_COM_REGRESSAO}`);
  await knex('automacao_emails')
    .where({ status: 'revisao', erro: ERRO_REGRESSAO_FUNIL })
    .update({ status: 'regressao_funil' });
};

exports.down = async function (knex) {
  await knex('automacao_emails')
    .where({ status: 'regressao_funil' })
    .update({ status: 'revisao' });
  await knex.raw(`ALTER TABLE automacao_emails MODIFY status ${ENUM_ANTERIOR}`);
};

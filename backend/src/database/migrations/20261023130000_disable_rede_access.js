exports.up = async function (knex) {
  await knex.transaction(async trx => {
    const config = await trx('configuracoes_acesso_rede').where({ id: 1 }).forUpdate().first();
    if (config?.modo === 'rede') {
      await trx('configuracoes_acesso_rede').where({ id: 1 }).update({
        ativo: false, modo: 'dispositivo', updated_at: new Date()
      });
      await trx('acesso_rede_solicitacoes').whereIn('estado', ['pendente', 'aprovado']).update({ estado: 'revogado' });
    }
    await trx('permissoes').where({ chave: 'configurar_acesso_rede' }).update({
      nome: 'Configurar acesso por dispositivos', descricao: 'Configura o bloqueio de acesso e gerencia os navegadores autorizados.'
    });
    await trx('permissoes').where({ chave: 'acesso_rede_sem_codigo' }).update({
      nome: 'Acessar sem código em qualquer navegador', descricao: 'Dispensa o código em navegadores não autorizados. Administradores são sempre dispensados.'
    });
  });
};

// Não reativa uma política retirada nem restaura liberações já revogadas.
exports.down = async function () {};

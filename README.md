# pos-venda
Sistema de pós venda da Avance

## Rotina de migrations no deploy

Em produção, a API executa automaticamente todas as migrations pendentes antes de abrir a porta HTTP. O fluxo de cada deploy é:

1. Publicar o código novo, incluindo `backend/src/database/migrations`.
2. Instalar as dependências quando o lockfile tiver mudado.
3. Reiniciar a aplicação Node pelo painel da hospedagem.
4. A inicialização chama `db.migrate.latest()` usando `backend/knexfile.js` e as variáveis de banco do ambiente.
5. Antes da migration, falhas transitórias de conexão ou lock são verificadas novamente com espera crescente.
6. A API e os agendamentos só iniciam depois que todas as migrations terminam com sucesso.

Não é necessário executar `npm run migrate` pelo SSH. Isso evita depender de `node` ou `npm` estarem disponíveis no `PATH` da sessão SSH.

Os logs de inicialização informam um dos resultados:

- `Banco de dados sem migrations pendentes.`
- `Migrations executadas: ...`
- `Falha ao iniciar o servidor: ...` — neste caso a aplicação não abre a porta e o deploy deve ser investigado.

### Configuração

- `NODE_ENV=production`: ativa migrations automáticas por padrão.
- `AUTO_MIGRATE=true`: força a execução automática em qualquer ambiente.
- `AUTO_MIGRATE=false`: desativa explicitamente a rotina, inclusive em produção. Use apenas como contingência temporária.
- `MIGRATION_MAX_ATTEMPTS=3`: número máximo de verificações de disponibilidade do banco.
- `MIGRATION_RETRY_DELAY_MS=5000`: espera inicial em milissegundos; as próximas esperas dobram até o limite de 30 segundos.

Depois que uma migration começa, nenhuma falha é repetida automaticamente. Como o MySQL aplica alterações de estrutura sem uma transação global neste projeto, uma repetição poderia executar novamente uma alteração já aplicada parcialmente. Erros de conexão durante a migration, SQL, estrutura ou código interrompem a nova instância, impedindo que código novo seja servido sobre um schema antigo ou parcialmente atualizado.

### Deploy com continuidade

Antes do deploy em produção:

1. Confirme que existe backup recente e restaurável do banco.
2. Escreva migrations compatíveis com a versão antiga e a nova da API: primeiro adicione tabelas e colunas; remova ou renomeie estruturas somente em um deploy posterior.
3. Faça o deploy pelo painel da hospedagem e acompanhe os logs até a mensagem de migrations concluídas.
4. Só direcione o tráfego para a nova instância depois que ela estiver saudável. A instância anterior deve continuar atendendo se a nova falhar.

A aplicação garante a parada segura da nova instância, mas continuidade sem indisponibilidade também depende da hospedagem manter a versão anterior ativa até o health check da nova. Se o provedor encerrar o processo antigo antes disso, não existe garantia de zero downtime somente pelo código deste projeto.

Nunca execute `knex migrate:rollback` automaticamente durante deploy. Uma reversão deve usar uma nova migration corretiva ou ser realizada manualmente após backup e análise.

## Automação Gmail da VIVO

A integração lê uma caixa Gmail dedicada com OAuth `gmail.readonly`, sem marcar ou alterar mensagens. Antes de habilitar, configure as variáveis `GMAIL_VIVO_*` descritas em `backend/.env.example`, uma data ISO em `GMAIL_VIVO_PROCESS_AFTER`, a lista exata de remetentes autorizados e `TELEGRAM_PROBLEMAS_CHAT_ID`. As notificações de problemas usam especificamente o bot configurado em `TELEGRAM_APROVACOES_BOT_TOKEN`. Faça o primeiro deploy com `GMAIL_VIVO_AUTOMATION_ENABLED=false`, valide as permissões e somente então habilite o worker. O corpo textual é removido do CRM após 12 meses; anexos e mensagens cujo conteúdo exista apenas em imagem não são processados automaticamente.

A publicação interna, a emissão segura do refresh token, o inventário de dados, a revogação e a revisão semestral estão documentados em [`docs/gmail-oauth-interno.md`](docs/gmail-oauth-interno.md).

## Automação IMAP da Claro

Configure `CLARO_IMAP_*` conforme `backend/.env.example` e use Node.js 22.19 ou superior (requisito da biblioteca de validação DKIM). A coleta usa IMAP somente leitura e só considera comprovada a origem quando a assinatura DKIM do MIME original é válida e seu domínio é exatamente o do remetente permitido; cabeçalhos `Authentication-Results` são apenas informativos. Mensagens antigas são rebuscadas no IMAP antes do reprocessamento. Se o original não existir ou não corresponder ao registro, o email permanece em revisão.

Na tela de Automações, abra **Prévia das revisões Claro** para conferir as contagens, razões extraídas, autenticação e motivos de exclusão das vendas. Depois, use **Reprocessar emails Claro** e confira o resultado por ID. A prévia identifica candidatos à tentativa, não garante conclusão: a assinatura e o vínculo são revalidados na execução. Registros sem corpo, com revisão manual ou sem formato reconhecido não entram no lote. O reprocessamento não liga as ações automaticamente.

Mantenha `CLARO_IMAP_AUTO_ACTIONS_ENABLED=false` até conferir os registros reais e validar o fluxo no ambiente. Após essa conferência, o responsável pelo deploy pode definir `CLARO_IMAP_AUTO_ACTIONS_ENABLED=true` no ambiente e reiniciar o worker. As ações atualizam apenas o Funil de Automações, com proteção contra repetição e regressão; nomes ambíguos ou origem não comprovada continuam em revisão.

## Correção retroativa de botões do Telegram

Para visualizar os encaminhamentos ativos que terão o botão corrigido, execute:

`cd backend && npm run telegram:corrigir-botoes-cancelamento -- --preview`

Para editar os botões no grupo do Telegram, execute:

`cd backend && npm run telegram:corrigir-botoes-cancelamento -- --confirm`

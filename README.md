# CRM Avance — sistema de vendas e pós-venda

![Node.js](https://img.shields.io/badge/Node.js-Express%205-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React%2019-20232A?logo=react&logoColor=61DAFB)
![MySQL](https://img.shields.io/badge/MySQL-Knex%20%2B%20Objection-4479A1?logo=mysql&logoColor=white)
![Testes](https://img.shields.io/badge/testes-1.557%20automatizados-success)
![Licença](https://img.shields.io/badge/Licen%C3%A7a-Todos%20os%20direitos%20reservados-red)

CRM em produção usado na rotina comercial da Avance: captação e distribuição de leads, funil de
vendas, cadastro e aprovação de vendas, clientes, retornos agendados, problemas de pós-venda,
fechamento mensal, relatórios e automações que leem e-mails das operadoras (Gmail/VIVO e
IMAP/Claro) e notificam a equipe pelo Telegram.

---

## Comprovação de experiência

| | |
|---|---|
| **Desenvolvedor principal** | Breno Luiz Silva do Carmo — autor de 608 dos 959 commits (63 %) |
| **Colaboração** | Árlisson Alves — 351 commits |
| **Tipo** | Sistema comercial em produção, de propriedade do autor |
| **Período de desenvolvimento** | 24/04/2026 a 28/10/2026 — **mais de seis meses** de desenvolvimento contínuo |
| **Verificação** | `npm run verify` — testes do backend e do frontend, lint sem avisos e build do frontend |

### Competências técnicas evidenciadas

| Competência | Onde verificar neste repositório |
|---|---|
| **Banco de dados** | MySQL com Knex e Objection.js: 216 migrations versionadas em [`backend/src/database/migrations/`](backend/src/database/migrations/), 43 modelos em [`backend/src/models/`](backend/src/models/); migrations automáticas no deploy com nova tentativa e proteção contra schema parcial (seção abaixo) |
| **Testes automatizados** | **895 testes de backend** (`node:test`, em [`backend/test/`](backend/test/)) e **662 testes de frontend** (Vitest + Testing Library, 92 arquivos); a suíte bloqueia qualquer conexão de rede fora de localhost |
| **React** | [`frontend/src/`](frontend/src/) — React 19 + React Router 7, 26 páginas (funil com arrastar-e-soltar via `@dnd-kit`, dashboard, relatórios, automações, fechamento mensal), layouts, serviços e utilitários testados |
| **Back-end / APIs** | [`backend/src/`](backend/src/) — Express 5 em camadas: 21 grupos de rotas, 28 controllers, serviços de domínio, middlewares; autenticação JWT com bcrypt, rate limit, permissões por papel e log de auditoria |
| **Integrações** | Gmail API (OAuth somente leitura), IMAP com validação DKIM (`mailauth`), bots do Telegram com webhook, Google Places, consulta de CNPJ, importação de planilhas (CSV/Excel) e integração com o [Dashboard Avance](https://github.com/danielfreitas2026/dashboard-avance) |
| **Outros frameworks de desenvolvimento web** | Vite 8, ESLint com zero avisos tolerados, JSDoc ([`jsdoc.config.json`](jsdoc.config.json), [`docs/jsdoc/`](docs/jsdoc/)) |
| **Segurança** | Headers de segurança ([`docs/security-headers.md`](docs/security-headers.md)), controle de acesso por rede e horário ([`docs/acesso-rede.md`](docs/acesso-rede.md)), recuperação de conta ([`docs/recuperacao-conta.md`](docs/recuperacao-conta.md)), inventário de dados e revogação do OAuth ([`docs/gmail-oauth-interno.md`](docs/gmail-oauth-interno.md)) |
| **Design e prototipagem de interfaces** | Telas operacionais para equipe de vendas: funil Kanban, filas de retorno, painéis de prévia antes de ações em lote |
| **GitHub / versionamento** | 959 commits ao longo de seis meses, com regras de contribuição documentadas em [`AGENTS.md`](AGENTS.md) (teste de regressão obrigatório, migrations nunca reescritas) |

---

## Estrutura

```
backend/
  src/
    routes/ controllers/ services/ models/ middlewares/
    database/migrations/    schema MySQL versionado
    server.js startup.js    inicialização com migrations automáticas
  test/                     testes do backend (node:test)
  scripts/                  diagnósticos e manutenção (IMAP, Telegram, reconciliação)
frontend/
  src/pages/ components/ layouts/ services/ utils/
  src/test/                 configuração do Vitest
docs/                       documentação operacional e de segurança
AGENTS.md                   regras de desenvolvimento do repositório
```

## Como verificar

Requisito: Node.js 22.19 ou superior.

```bash
npm install
npm --prefix frontend install
npm run verify
```

---

## Operação em produção

### Rotina de migrations no deploy

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

#### Configuração

- `NODE_ENV=production`: ativa migrations automáticas por padrão.
- `AUTO_MIGRATE=true`: força a execução automática em qualquer ambiente.
- `AUTO_MIGRATE=false`: desativa explicitamente a rotina, inclusive em produção. Use apenas como contingência temporária.
- `MIGRATION_MAX_ATTEMPTS=3`: número máximo de verificações de disponibilidade do banco.
- `MIGRATION_RETRY_DELAY_MS=5000`: espera inicial em milissegundos; as próximas esperas dobram até o limite de 30 segundos.

Depois que uma migration começa, nenhuma falha é repetida automaticamente. Como o MySQL aplica alterações de estrutura sem uma transação global neste projeto, uma repetição poderia executar novamente uma alteração já aplicada parcialmente. Erros de conexão durante a migration, SQL, estrutura ou código interrompem a nova instância, impedindo que código novo seja servido sobre um schema antigo ou parcialmente atualizado.

#### Deploy com continuidade

Antes do deploy em produção:

1. Confirme que existe backup recente e restaurável do banco.
2. Escreva migrations compatíveis com a versão antiga e a nova da API: primeiro adicione tabelas e colunas; remova ou renomeie estruturas somente em um deploy posterior.
3. Faça o deploy pelo painel da hospedagem e acompanhe os logs até a mensagem de migrations concluídas.
4. Só direcione o tráfego para a nova instância depois que ela estiver saudável. A instância anterior deve continuar atendendo se a nova falhar.

A aplicação garante a parada segura da nova instância, mas continuidade sem indisponibilidade também depende da hospedagem manter a versão anterior ativa até o health check da nova. Se o provedor encerrar o processo antigo antes disso, não existe garantia de zero downtime somente pelo código deste projeto.

Nunca execute `knex migrate:rollback` automaticamente durante deploy. Uma reversão deve usar uma nova migration corretiva ou ser realizada manualmente após backup e análise.

### Automação Gmail da VIVO

A integração lê uma caixa Gmail dedicada com OAuth `gmail.readonly`, sem marcar ou alterar mensagens. Antes de habilitar, configure as variáveis `GMAIL_VIVO_*` descritas em `backend/.env.example`, uma data ISO em `GMAIL_VIVO_PROCESS_AFTER`, a lista exata de remetentes autorizados e `TELEGRAM_PROBLEMAS_CHAT_ID`. As notificações de problemas usam especificamente o bot configurado em `TELEGRAM_APROVACOES_BOT_TOKEN`. Faça o primeiro deploy com `GMAIL_VIVO_AUTOMATION_ENABLED=false`, valide as permissões e somente então habilite o worker. O corpo textual é removido do CRM após 12 meses; anexos e mensagens cujo conteúdo exista apenas em imagem não são processados automaticamente.

A publicação interna, a emissão segura do refresh token, o inventário de dados, a revogação e a revisão semestral estão documentados em [`docs/gmail-oauth-interno.md`](docs/gmail-oauth-interno.md).

### Automação IMAP da Claro

Configure `CLARO_IMAP_*` conforme `backend/.env.example` e use Node.js 22.19 ou superior (requisito da biblioteca de validação DKIM). A coleta usa IMAP somente leitura e só considera comprovada a origem quando a assinatura DKIM do MIME original é válida e seu domínio é exatamente o do remetente permitido; cabeçalhos `Authentication-Results` são apenas informativos. Mensagens antigas são rebuscadas no IMAP antes do reprocessamento. Se o original não existir ou não corresponder ao registro, o email permanece em revisão.

Na tela de Automações, abra **Prévia das revisões Claro** para conferir as contagens, razões extraídas, autenticação e motivos de exclusão das vendas. Depois, use **Reprocessar emails Claro** e confira o resultado por ID. A prévia identifica candidatos à tentativa, não garante conclusão: a assinatura e o vínculo são revalidados na execução. Registros sem corpo, com revisão manual ou sem formato reconhecido não entram no lote. O reprocessamento não liga as ações automaticamente.

Mantenha `CLARO_IMAP_AUTO_ACTIONS_ENABLED=false` até conferir os registros reais e validar o fluxo no ambiente. Após essa conferência, o responsável pelo deploy pode definir `CLARO_IMAP_AUTO_ACTIONS_ENABLED=true` no ambiente e reiniciar o worker. As ações atualizam apenas o Funil de Automações, com proteção contra repetição e regressão; nomes ambíguos ou origem não comprovada continuam em revisão.

### Avisos opcionais do Telegram

Os avisos abaixo ficam desligados por padrão, inclusive em produção. Configure cada chave individualmente no ambiente do servidor e reinicie o backend após qualquer alteração:

| Variável | Função habilitada com `true` |
| --- | --- |
| `TELEGRAM_ACOMPANHAMENTO_ATIVO` | Textos de aceite e avisos de retorno agendado e venda fechada dos futuros clientes. |
| `TELEGRAM_VENDAS_ATIVO` | Notificação detalhada de novas vendas cadastradas. |
| `TELEGRAM_RESUMO_VENDAS_ATIVO` | Envio de resumos diários e semanais, inclusive chamadas diretas. |

A ausência da chave, `false` ou qualquer valor diferente de `true` mantém a função desligada. Espaços e maiúsculas são ignorados. Para o envio agendado dos resumos, `TELEGRAM_RESUMO_VENDAS_ATIVO=true` também precisa da permissão de `TELEGRAM_RESUMO_VENDAS_AGENDAMENTO_ATIVO`: `true` habilita, `false` desabilita; quando ausente, o agendamento é permitido somente em produção. O horário continua às 18h de São Paulo, em dias úteis, com fechamento semanal às sextas-feiras.

A distribuição dos futuros clientes mantém encaminhamento, cancelamento, atualização dos botões, prazos, encerramento das publicações antigas e republicação dos contatos devolvidos. Aprovações de vendas e alertas de problemas pós-venda continuam usando suas configurações existentes. A desativação não altera históricos nem provoca envio retroativo ao reativar os avisos.

### Correção retroativa de botões do Telegram

Para visualizar os encaminhamentos ativos que terão o botão corrigido, execute:

`cd backend && npm run telegram:corrigir-botoes-cancelamento -- --preview`

Para editar os botões no grupo do Telegram, execute:

`cd backend && npm run telegram:corrigir-botoes-cancelamento -- --confirm`

---

## Autor

**Breno Luiz Silva do Carmo**
[LinkedIn](https://www.linkedin.com/in/breno-luiz-silva-do-carmo-19451a243/) ·
[GitHub](https://github.com/Bren0-lz)

## Licença

Copyright (c) 2026 Breno Luiz Silva do Carmo. Todos os direitos reservados.
Nenhuma parte deste código pode ser utilizada, reproduzida, distribuída ou modificada sem
autorização prévia por escrito do autor. Veja [LICENSE](LICENSE).

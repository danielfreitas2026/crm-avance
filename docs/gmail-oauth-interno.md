# Integração Gmail: publicação interna e operação

Este documento descreve a configuração de produção da automação que lê a caixa corporativa dedicada da Avance VIP. Ele não contém credenciais. Client secret, refresh token, endereço da caixa e IDs de chat devem existir somente no cofre de variáveis do ambiente.

## Arquitetura autorizada

- Público OAuth: **Internal**, limitado à organização Google Workspace da Avance VIP.
- Conta autorizada: uma caixa corporativa dedicada, conferida em execução por `GMAIL_VIVO_ACCOUNT`.
- Escopo: somente `https://www.googleapis.com/auth/gmail.readonly`.
- Acesso ao Gmail: leitura; o CRM não envia, altera, marca ou exclui mensagens.
- Projetos: um projeto Google Cloud de produção e outro separado para testes, ambos sob controle da organização.
- Usuários externos, contas pessoais e caixas de outros domínios não são suportados.

O uso interno evita a tela de aplicativo não verificado, o limite de usuários de teste e a expiração de sete dias imposta a refresh tokens de aplicativos externos em modo de teste. A exceção deixa de valer se o público ou as contas autorizadas forem ampliados.

## Checklist do Google Cloud e Workspace

1. No projeto de produção, confirme que a organização proprietária é a organização Google Workspace da Avance VIP.
2. Em Google Auth Platform, defina o público como **Internal**. Não deixe o cliente de produção em `External / Testing`.
3. Preencha nome do aplicativo, e-mail de suporte e contatos técnicos mantidos pela empresa.
4. Habilite a Gmail API e declare somente o escopo `gmail.readonly`.
5. Cadastre como URLs públicas:
   - `https://pos-venda.avancevip.net.br/integracao-gmail`
   - `https://pos-venda.avancevip.net.br/privacidade`
   - `https://pos-venda.avancevip.net.br/termos`
6. Confirme que `avancevip.net.br` está verificado pela organização no Google Search Console.
7. No Google Admin Console, em controles de acesso de aplicativos, permita o cliente OAuth para a unidade organizacional da caixa dedicada. Se a política bloquear escopos restritos, marque o cliente corporativo como confiável.
8. Mantenha proprietários, editores, e-mail de suporte e contatos do projeto atualizados. Use grupos corporativos quando possível para evitar dependência de uma única pessoa.

Aplicativos internos não precisam ser enviados para a verificação pública de escopo restrito nem para a avaliação CASA enquanto projeto, público e contas permanecerem dentro da mesma organização.

## Emissão e troca do refresh token

1. Mantenha `GMAIL_VIVO_AUTOMATION_ENABLED=false` durante a troca.
2. Revogue a concessão antiga na área de conexões de terceiros da conta Google dedicada. Se um token ou código de autorização foi exibido fora do cofre, considere-o comprometido e não o reutilize.
3. Autorize o cliente de produção com a conta conferida em `GMAIL_VIVO_ACCOUNT`, usando exatamente `gmail.readonly`, acesso offline e consentimento explícito.
4. Grave o refresh token diretamente em `GMAIL_VIVO_REFRESH_TOKEN` no cofre da hospedagem. Não o envie por mensagem, chamado, captura de tela ou commit.
5. Faça um novo deploy/restart com a automação ainda desabilitada e confira os logs de inicialização.
6. Habilite a automação e acompanhe `/automacoes`. O primeiro ciclo deve concluir em até cinco minutos.
7. Confirme a conta esperada, a ausência de `invalid_grant`, 401 ou 403, a coleta do backlog e a redução das pendências.
8. Verifique um alerta de problema no Telegram sem copiar conteúdo real para o registro desta validação.

Uma resposta normal de renovação fornece um access token temporário. O refresh token de um aplicativo interno não deve apresentar o prazo de sete dias associado ao modo externo de testes.

## Revogação e incidente

Quando a integração precisar ser desligada ou houver suspeita de exposição:

1. Defina `GMAIL_VIVO_AUTOMATION_ENABLED=false` e confirme no painel que a integração aparece desabilitada.
2. Revogue o acesso do aplicativo na conta Google e, quando necessário, bloqueie o cliente no Google Admin Console.
3. Remova `GMAIL_VIVO_REFRESH_TOKEN` do cofre; não substitua por texto fictício.
4. Preserve o histórico comercial já existente. A revogação interrompe novas coletas, mas não executa exclusão retroativa.
5. Registre data, motivo, responsável, alcance conhecido e ações tomadas no processo interno de incidentes, sem incluir tokens ou conteúdo de mensagens.
6. Para reativar, corrija a causa, emita uma nova concessão e repita integralmente o checklist de troca.

## Inventário de dados

| Categoria | Origem e finalidade | Armazenamento e acesso | Retenção |
| --- | --- | --- | --- |
| IDs da mensagem e conversa | Gmail; deduplicação, rastreabilidade e nova leitura autorizada | Banco do CRM; administradores da automação | Enquanto o registro comercial relacionado for mantido |
| Remetente, assunto e horário | Gmail; seleção, consulta e auditoria | Banco do CRM; usuários com permissão de automações | Enquanto o registro comercial relacionado for mantido |
| Corpo textual | Gmail; interpretação do retorno da operadora | Banco do CRM; usuários com permissão de automações | Removido automaticamente após 12 meses |
| Documento, pedido, destino e mensagem da operadora | Extraídos do corpo; associação à venda e execução das regras | Banco do CRM e telas protegidas | Enquanto o registro comercial relacionado for mantido |
| Status, vínculos, revisões e erros sanitizados | Gerados pelo CRM; operação e auditoria | Banco do CRM; usuários autorizados | Enquanto o registro comercial relacionado for mantido |
| Alerta de problema | CRM; comunicação operacional | Telegram corporativo; membros autorizados do grupo | Conforme a política e administração do grupo corporativo |

O alerta enviado ao Telegram pode incluir número e nome da venda, razão social, CNPJ ou CPF e a mensagem da operadora. Essa transferência deve permanecer restrita ao grupo corporativo aprovado.

## Solicitações de titulares

- O canal público indicado em `/privacidade` recebe pedidos de acesso, correção, oposição e exclusão.
- O responsável de privacidade identifica os registros do titular, avalia obrigações legais e comerciais e aciona os administradores do CRM.
- A exclusão não deve quebrar a deduplicação ou a auditoria. Quando a manutenção integral deixar de ser necessária, prefira anonimizar dados pessoais e preservar IDs técnicos, datas, status e vínculos mínimos.
- A conclusão e a justificativa da decisão devem ser registradas no processo interno, sem incluir dados além do necessário.

## Revisão operacional semestral

A equipe responsável deve executar esta revisão em **15 de março** e **15 de setembro**, ou no próximo dia útil:

- confirmar proprietários, editores, suporte e contatos técnicos do projeto;
- conferir público interno, organização proprietária, escopos e APIs habilitadas;
- revisar a lista de aplicativos confiáveis no Workspace Admin;
- validar as páginas públicas e os dados institucionais publicados;
- conferir permissões do CRM, membros do grupo do Telegram e prazo de retenção;
- revisar alertas de saúde da automação e documentar falhas recorrentes;
- confirmar que nenhum segredo foi armazenado no repositório ou em documentação.

Se a empresa decidir aceitar contas externas, a mudança deve ser tratada como um novo projeto: projeto OAuth externo separado, domínio e páginas verificados, justificativa de escopo, vídeo demonstrativo, verificação do escopo restrito, avaliação CASA e recertificação anual.

## Referências oficiais

- [Exceções à verificação OAuth](https://support.google.com/cloud/answer/13464323)
- [Preparação para produção](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Escopos da Gmail API](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

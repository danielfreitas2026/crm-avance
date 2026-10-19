# Recuperação de conta

O e-mail de acesso identifica a conta no CRM e pode ser fictício. O e-mail real de
recuperação é um campo separado, configurado pelo próprio usuário em **Editar
perfil** mediante sua senha atual. Usuários existentes começam sem esse endereço.
O endereço pode pertencer a qualquer provedor. Notificações existentes continuam
usando seus destinatários e permissões atuais.

## Configuração e deploy

- Configure o transporte já usado pelo CRM: `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`,
  `SMTP_PORT` e `SMTP_SECURE`. Os aliases `EMAIL`, `EMAIL_PASSWORD`, `EMAIL_HOST`,
  `EMAIL_PORT` e `EMAIL_SECURE` continuam tendo prioridade. Em 465 use TLS com
  `SMTP_SECURE=true`; em 587 use `false` para negociar STARTTLS.
- Configure `FRONTEND_URL` com a URL pública HTTPS do CRM. O domínio vem apenas da
  configuração do servidor, nunca de cabeçalhos enviados pelo solicitante.
- Preserve `USUARIO_SENHA_ENCRYPTION_KEY`: a recuperação grava tanto o bcrypt
  quanto a cópia criptografada usada pelo recurso administrativo existente.
- O deploy aplica a migration aditiva `20261019120000_add_recuperacao_conta` pelo
  fluxo de inicialização existente. Não é necessário preencher dados antigos.
- O servidor do frontend deve entregar `index.html` nas rotas públicas
  `/esqueci-minha-senha`, `/confirmar-email-recuperacao` e `/redefinir-senha`.
- Não execute rollback destrutivo automaticamente. A migration `down` remove os
  endereços e tokens. Reverter para código sem verificação da versão de sessão
  também retira a proteção de revogação dos JWTs; prefira correção aditiva e não
  misture instâncias antigas e novas durante a ativação desse recurso.

Exemplos de nomes de variáveis ficam em `backend/.env.example`. Não copie segredos
para documentação, testes, logs ou Git.

## Fluxo e contratos

`PUT /api/auth/me` aceita `email_recuperacao` e `senha_atual`. O endereço novo fica
pendente; o anterior confirmado continua funcionando. `null` ou string vazia
remove ambos os endereços, mediante a senha atual. Omitir o campo preserva tudo.
Selecionar novamente o endereço confirmado cancela uma substituição pendente.

A confirmação exige clicar no botão da página recebida por e-mail. O token vale
24 horas. O reenvio em `POST /api/auth/reenviar-confirmacao-email-recuperacao`
recebe `{ senha_atual }` e invalida a confirmação anterior. A confirmação em
`POST /api/auth/confirmar-email-recuperacao` recebe `{ token }` e invalida todos os
links anteriores dessa conta. O endereço e o estado aparecem apenas nas respostas
do próprio perfil; o login e as listagens de usuários não os retornam.

`POST /api/auth/forgot-password` recebe `{ email }` com o identificador de acesso.
Só contas ativas com endereço confirmado recebem o link. A resposta pública é
igual para conta ausente, sem confirmação, cota excedida ou falha de envio.
Quem não configurou a recuperação precisa procurar um administrador.

`POST /api/auth/reset-password` recebe `{ token, senha }`. O link vale uma hora,
é de uso único e exige senha com ao menos oito caracteres, um número e até 72
bytes UTF-8. Todas as trocas de senha invalidam os links de redefinição existentes.
Redefinir pelo link também incrementa a versão de sessão: cada dispositivo perde
o acesso na próxima requisição e precisa entrar novamente. Não há login automático.
JWTs anteriores à implantação equivalem à versão zero, válidos até a recuperação.
Horários e permissões de acesso continuam sendo aplicados ao novo login.

Tokens aleatórios de 32 bytes trafegam no fragmento do link (`#token=...`) e no
corpo do POST. O banco guarda apenas SHA-256, finalidade, destinatário, expiração
e consumo. Transações bloqueiam primeiro o usuário e depois os tokens, revalidando
o estado sob o bloqueio; dois cliques simultâneos não podem usar o mesmo link.

## Limites e operação

As novas rotas compartilham o limite de dez requisições por minuto por IP em cada
processo. Alterações do e-mail em `PUT /api/auth/me` também passam por esse limite.
O limite adicional de dois envios por hora, conta e finalidade é persistido no
banco e funciona entre instâncias. Reenvios contam; falhas SMTP com rollback não
consomem essa cota. As finalidades de confirmação e redefinição têm cotas separadas.

O limitador usa `req.ip`, sem habilitar confiança em `X-Forwarded-For`. Atrás de
proxy, clientes podem compartilhar a cota do IP do proxy. Qualquer configuração
futura de `trust proxy` deve listar exclusivamente os proxies efetivamente
controlados pela hospedagem; nunca confiar indiscriminadamente nesses cabeçalhos.

O envio SMTP ocorre dentro da transação para que falhas não salvem alterações
parciais nem indiquem sucesso no perfil. O transporte tem timeouts de conexão e
leitura; durante o envio, a linha dessa conta permanece bloqueada. Se o commit ou
a auditoria falhar depois de o provedor aceitar a mensagem, o link recebido pode
ser inválido: solicite outro envio. Não há fila nem reenvio automático.

Eventos de auditoria registram solicitação, confirmação, reenvio, alterações do
perfil e redefinição, sem tokens ou senhas. Falhas dos novos fluxos têm mensagens
genéricas nos logs. Acompanhe essas falhas e as respostas 429/503 na operação.

## Validação

Os testes usam mocks de persistência e SMTP e HTTP apenas em localhost, mantendo
a proteção de rede da suíte. A concorrência é coberta por transações isoladas em
memória e verificações de bloqueio; a migration tem validação do SQL gerado para
MySQL. A entrega não executa migrations nem envia mensagens em produção.

Execute testes direcionados de recuperação, autenticação e senha, os testes de
interação das páginas e, por fim, `npm run verify`. Smoke tests de integração só
podem ser executados mediante solicitação explícita.

## Arquivos desta implementação

Backend — configuração e persistência:

- `backend/.env.example`, `backend/package.json`, `backend/package-lock.json`
- `backend/src/database/migrations/20261019120000_add_recuperacao_conta.js`
- `backend/src/models/Usuario.js`, `backend/src/models/RecuperacaoContaToken.js`

Backend — fluxo e proteções:

- `backend/src/controllers/auth.controller.js`
- `backend/src/controllers/recuperacao-conta.controller.js`
- `backend/src/routes/auth.routes.js`
- `backend/src/middlewares/auth.middleware.js`
- `backend/src/services/auth.service.js`
- `backend/src/services/usuario.service.js`
- `backend/src/services/horario-acesso.service.js`
- `backend/src/services/email-transporte.service.js`
- `backend/src/services/notificacao-email.service.js`
- `backend/src/services/recuperacao-conta-email.service.js`
- `backend/src/services/recuperacao-conta.service.js`
- `backend/src/utils/alteracoes-auditoria.js`

Frontend:

- `frontend/src/pages/LoginPage/LoginPage.jsx`
- `frontend/src/pages/EditarPerfilPage/EditarPerfilPage.jsx`
- `frontend/src/pages/RecuperacaoContaPage/RecuperacaoContaPage.jsx`
- `frontend/src/pages/RecuperacaoContaPage/RecuperacaoContaPage.css`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/services/auth.service.js`

Testes:

- `backend/test/recuperacao-conta.test.js`
- `backend/test/email-transporte.test.js`
- `backend/test/horario-acesso.test.js`
- `backend/test/senha-usuario.test.js`
- `frontend/src/pages/EditarPerfilPage/EditarPerfilRecuperacao.test.jsx`
- `frontend/src/pages/RecuperacaoContaPage/RecuperacaoContaPage.test.jsx`
- `frontend/src/pages/RecuperacaoContaPage/RecuperacaoContaRoutes.test.jsx`
- `frontend/src/services/auth.service.test.js`

Documentação: `docs/recuperacao-conta.md`.

# Acesso por rede e código administrativo

O recurso começa **desativado**, inclusive após a migration automática do deploy.
Administradores sempre entram sem código, independentemente das permissões
individuais. Para os demais, a permissão `acesso_rede_sem_codigo`, individual ou
do perfil, dispensa o código. Essa dispensa não ignora conta inativa, horário de
funcionamento, expiração do JWT nem a versão de sessão.

## Liberação inicial de todos os usuários

A migration `20261021121000_grant_initial_acesso_rede_sem_codigo` concede
`acesso_rede_sem_codigo` individualmente a todas as contas existentes no momento
da execução, inclusive às inativas, preservando as demais permissões. Isso não
ativa contas, não concede administração da configuração e não altera perfis,
horários ou o estado do bloqueio. A implantação inicial continua desativada.

A concessão ocorre uma única vez, pelo histórico de migrations do Knex. Não há
concessão automática a cada inicialização ou deploy. Depois de preparar e testar
a ferramenta, remova a permissão dos usuários que deverão precisar de código.
Confira também o perfil: uma dispensa concedida pelo perfil continua valendo.
Administradores são sempre dispensados. Novos usuários seguem as permissões
escolhidas no cadastro, sem receber automaticamente essa concessão inicial.

As atualizações usam uma transação com bloqueio das linhas dos usuários. Se
houver permissões ilegíveis ou falha de gravação, toda a concessão é desfeita e
a inicialização informa a falha, sem apagar as permissões existentes. O `down`
dessa migration não modifica dados, pois não seria seguro distinguir uma
concessão inicial de uma autorização ou remoção posterior feita manualmente.

## Preparação e ativação

1. Publique backend, frontend e a migration aditiva em todas as instâncias.
   Instâncias antigas não podem continuar recebendo tráfego quando a restrição
   for ativada. As migrations seguem o fluxo automático já documentado no README.
2. No cofre/painel do servidor, configure `TELEGRAM_BOT_TOKEN` (bot existente) e
   `TELEGRAM_ACESSO_REDE_CHAT_ID` (conversa exclusiva de administração). Somente
   os responsáveis por autorizar acessos devem participar dessa conversa. Não
   coloque códigos, tokens ou credenciais em chamados, logs ou no Git.
3. Identifique a topologia da hospedagem. Sem proxy, deixe `TRUSTED_PROXY_CIDRS`
   vazio. Com proxy reverso, liste apenas os IPs/faixas dos proxies realmente
   controlados e confiáveis, separados por vírgulas. Não use `true`, nomes
   genéricos de redes, `0.0.0.0/0` ou `::/0`. Restrinja o acesso direto à API
   conforme a topologia e assegure que os proxies tratem o encaminhamento do IP.
4. Reinicie a API depois de configurar essas variáveis. Acesse **Configurações →
   Acesso por rede** com a permissão `configurar_acesso_rede`. Administradores
   existentes recebem essa permissão na migration; novos administradores podem
   recebê-la no gerenciamento de permissões.
5. Ainda com o recurso desativado, confira o IP detectado usando a internet da
   empresa e uma conexão externa, por exemplo, o celular fora do Wi-Fi. Os IPs
   devem corresponder às respectivas conexões. Se ambos mostram o endereço do
   servidor/proxy, corrija a configuração antes de ativar. Não cadastre o IP do
   proxy como se fosse a rede da empresa.
6. Cadastre os IPs públicos ou faixas da empresa, incluindo IPv6 se usado. Ative
   somente após essa conferência. É necessário manter pelo menos um usuário
   ativo dispensado e autorizado a configurar o recurso.

A comparação usa o IP visto pela API, não o nome do Wi-Fi. Uma VPN com saída
pela empresa também será interna. IP público dinâmico pode exigir atualização
do cadastro; enquanto isso, os usuários não dispensados precisarão de código.
Para desativar, use a mesma tela com um administrador autorizado. Não execute
rollback destrutivo: mantenha as tabelas e prefira uma correção aditiva.

## Solicitação e autorização

Depois da senha correta, a API exige autorização externa sem emitir JWT de
acesso ao CRM. Uma sessão que muda de rede também é bloqueada na próxima
requisição protegida. O Telegram recebe nome, e-mail, IP, horário de São Paulo,
identificador da solicitação e seis letras. Confirme a identidade da pessoa e
repasse o código por um canal escolhido por você.

O código vale dez minutos, aceita maiúsculas/minúsculas, permite cinco erros e
é consumido uma única vez em transação. O banco guarda apenas HMAC do código,
vinculado à solicitação, usando a chave JWT com contexto próprio. O identificador
é aleatório; nenhuma resposta ao solicitante contém o código. Auditoria registra
solicitações, falhas de validação, liberações e alterações de configuração sem
códigos nem JWTs.

A autorização vale para um usuário, sessão, versão de sessão e IP, até o JWT
expirar ou o logout revogá-la. Aprovar uma sessão existente mantém sua expiração.
Uma nova aprovação em outro IP substitui a liberação anterior da mesma sessão.
Novos logins têm `jti` aleatório. Tokens antigos são identificados por SHA-256 e
recebem essa identificação como `jti` após aprovação, sem ampliar a validade.
Remover a dispensa exige código na próxima requisição externa, exceto quando a
sessão já possui aprovação válida para aquele IP. Alterar a configuração de
redes revoga todas as solicitações e aprovações anteriores.

O logout limpa os dados locais e tenta revogar a autorização no servidor. Se o
servidor estiver indisponível, a tela de login informa que não foi possível
confirmar a revogação; uma cópia do token anterior pode continuar autorizada até
expirar. Dados já enviados ao navegador e operações já iniciadas antes da troca
de rede não podem ser recolhidos pelo bloqueio; a regra é verificada no início
de cada requisição protegida. Operações recusadas não são repetidas automaticamente.

## Limites e falhas

Solicitações pendentes da mesma sessão/IP são reutilizadas; antes da emissão
do primeiro JWT, logins repetidos da mesma conta/IP reutilizam a solicitação
pendente. Há uma emissão por minuto e cinco por hora por usuário e até vinte
emissões por minuto por IP. Esses limites ficam no banco e valem entre instâncias.
Login e validação também compartilham vinte chamadas por minuto/IP por processo.

Falha do Telegram mantém o bloqueio, invalida a solicitação e conta na cota de
emissões, evitando tempestade de reenvios. Aguarde um minuto e tente novamente.
Não há fila nem reenvio automático. Se o Telegram aceitar a mensagem e o commit
ou a auditoria falhar, o código recebido pode não ser válido. Solicite outro,
respeitando as cotas. Acompanhe respostas 429/503 e falhas genéricas de operação.

## Contratos e testes

- `GET/PUT /api/config/admin/acesso-rede`: diagnóstico/configuração, com permissão
  `configurar_acesso_rede`. A atualização recebe `{ ativo, redes }`.
- Login e requisições protegidas retornam `403 NETWORK_ACCESS_REQUIRED` com
  `solicitacao_id` e `expira_em` quando um código está pendente.
- `POST /api/auth/acesso-rede/validar`: recebe `{ solicitacao_id, codigo }` e,
  após revalidar conta, IP, horário e versão, responde `{ token, usuario }`.
- `POST /api/auth/logout`: recebe o Bearer JWT e revoga solicitações/liberações
  daquela sessão, mesmo quando a rede ou o horário estiver bloqueado.
- O servidor do frontend deve entregar `index.html` em `/verificar-acesso`.

Os testes simulam persistência e Telegram e usam HTTP apenas em localhost.
Execute os testes direcionados de acesso por rede e autenticação, os testes
das telas e `npm run verify`. Nenhum smoke test de Telegram ou mudança em
produção faz parte da verificação automática.

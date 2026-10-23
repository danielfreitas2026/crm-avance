# Acesso por dispositivos e código administrativo

Em instalações novas, o controle começa **desativado**. Este deploy não ativa
restrições automaticamente.
Administradores sempre entram sem código, independentemente das permissões
individuais. Para os demais, a permissão `acesso_rede_sem_codigo`, individual ou
do perfil, dispensa o código. Essa dispensa não ignora conta inativa, horário de
funcionamento, expiração do JWT nem a versão de sessão.

## Retirada do controle por rede

O modo por IP foi desativado. IPs/faixas da empresa não liberam mais acessos e
não podem mais ser configurados pela tela. As rotas, nomes de tabelas e chaves
`configurar_acesso_rede`/`acesso_rede_sem_codigo` foram mantidos por compatibilidade.

A migration aditiva `20261023130000_disable_rede_access` transforma uma
configuração antiga `rede` em `dispositivo` **desativado**, revogando solicitações
e liberações temporárias do modo antigo. Isso evita ativar outro bloqueio sem
preparação. Se o controle por navegador já estava configurado, seu estado de
ativação e suas liberações são preservados. Contas, perfis, horários e cadastros
de navegadores não são alterados. As redes antigas ficam arquivadas no banco,
sem efeito na autorização. O rollback não reativa a política retirada.

Publique backend, frontend e migrations em todas as instâncias. Não mantenha
instâncias antigas recebendo tráfego, pois ainda poderiam aplicar a regra por IP.

## Navegadores autorizados

Em **Configurações → Acesso por dispositivos**, o controle funciona por
navegador autorizado. Apenas um navegador autorizado ou uma conta dispensada
pode entrar sem código. Os computadores cadastrados devem permanecer na empresa.
O cadastro vale para qualquer funcionário que use aquele perfil do navegador;
login, senha, conta ativa e horários continuam sendo verificados.

Para preparar, ainda sem mudar o estado atual do bloqueio:

1. Publique a migration aditiva, backend e frontend em todas as instâncias.
   A migração do modo antigo está descrita acima. Não execute rollback para remover cadastros;
   desative o controle pela configuração e faça reparos de schema aditivos.
2. Em cada computador, abra o navegador usado pelo funcionário e entre com uma
   conta que tenha `configurar_acesso_rede`. Em **Autorizar este navegador**,
   informe um nome identificável (por exemplo, “Recepção Chrome”) e sua senha atual.
   A tela confirma que o navegador recebeu a credencial antes de anunciar sucesso.
3. Saia da conta administrativa. A autorização do navegador permanece e atende
   os outros funcionários. Outro navegador, perfil ou janela anônima não recebe
   essa autorização.
4. Configure o Telegram e mantenha uma conta ativa dispensada com permissão de
   configuração. Ative e salve quando estiver pronto. Não é necessário
   cadastrar redes nem contratar IP fixo.
5. Retire manualmente `acesso_rede_sem_codigo` dos funcionários que deverão
   seguir o controle, conferindo também os perfis. A dispensa inicial não será
   removida nem concedida novamente por este deploy. Administradores continuam
   dispensados automaticamente.
6. Confira uma conta comum em um navegador cadastrado e em outro não cadastrado,
   incluindo login, upload, download, logout e revogação.

A lista administrativa mostra nome, responsável, data, situação e o navegador
atual. A revogação exige confirmação e retira a dispensa na próxima requisição
protegida, inclusive em sessões já abertas. Uma liberação temporária já obtida
por código permanece válida até o logout/expiração da sessão e somente naquele IP.
Mudar a configuração invalida essas liberações temporárias, preservando os
cadastros permanentes. Reautorizar um navegador revogado exige novo cadastro e
nova credencial. A aprovação temporária do Telegram nunca cadastra um navegador.

O cadastro não expira no servidor. A credencial de 256 bits fica em cookie
`HttpOnly`, `Secure`, `SameSite=Lax`, exclusivo do host da API e com prefixo
`__Host-` em produção. Não há `Domain`, JWT especial ou segredo no armazenamento
JavaScript. Somente o hash fica no banco; respostas e auditoria contêm metadados.
O cookie dura 400 dias, renovados em login ou consulta autenticada de perfil
quando a credencial ainda é válida. Navegadores podem removê-lo antes disso;
apagar dados, reinstalar sem preservar o perfil ou perder o cookie exige nova
autorização. Logout e troca de usuário não apagam o cookie.

Esta é uma identificação pela posse da credencial, não uma vinculação física
inviolável ao computador. Uma cópia indevida do perfil/credencial pode transferir
a autorização. O navegador autorizado deve ficar sob controle da empresa.

Frontend e API devem usar HTTPS no mesmo site, como os subdomínios atuais.
Todas as chamadas enviam cookies, preservando o JWT Bearer e CORS explícito.
Somente desenvolvimento/testes em localhost permite cookie sem `Secure`; use
o mesmo hostname local no frontend e backend. Não há nova variável de ambiente.
As mutações exigem uma origem explicitamente permitida, inclusive o `PUT` de
configuração; clientes administrativos devem enviar `Origin` permitido.

### APIs de navegadores

- `GET/PUT /api/config/admin/acesso-rede`: retorna `modo: "dispositivo"`.
  O `PUT` recebe `{ ativo, modo? }`. Omitir `modo` utiliza dispositivos;
  `modo: "rede"` é recusado. O campo antigo `redes` é ignorado e não altera
  os valores arquivados no banco.
- `GET /api/config/admin/acesso-rede/dispositivos`: retorna
  `{ dispositivo_atual_id, dispositivos }`, sem credenciais ou hashes.
- `POST /api/config/admin/acesso-rede/dispositivos/atual`: recebe
  `{ nome, senha_atual }`, responde `{ dispositivo }` e define o cookie somente
  após commit. Exige senha atual, sessão válida e permissão de configuração.
  Limite adicional de dez tentativas por minuto/IP por instância.
- `DELETE /api/config/admin/acesso-rede/dispositivos/:id`: revoga o cadastro
  com permissão de configuração; remove o cookie se for o navegador atual.
- `403 NETWORK_ACCESS_REQUIRED` preserva o contrato existente e acrescenta
  `modo`, usado na mensagem de verificação. Os códigos mantêm validade de
  trinta minutos, cinco erros e os limites já descritos abaixo.

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

## Infraestrutura

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
4. Reinicie a API e confira o IP identificado na resposta administrativa
   `GET /api/config/admin/acesso-rede`, dentro e fora da empresa. O IP continua
   necessário para vincular códigos temporários, limitar tentativas e auditar.
   Ele não reconhece nem libera automaticamente a rede da empresa.
5. Cadastre os navegadores e ative o controle conforme as instruções acima.
   Para desativar, use a mesma tela com uma conta autorizada.

## Solicitação e autorização

Depois da senha correta, a API exige código em navegador não autorizado e conta
sem dispensa, sem emitir JWT de acesso ao CRM. Uma sessão autorizada somente por
código que muda de IP precisa de outro código. Navegadores cadastrados continuam
dispensados mesmo mudando de IP. O Telegram recebe nome, e-mail, IP, horário de São Paulo,
identificador da solicitação e seis letras. Confirme a identidade da pessoa e
repasse o código por um canal escolhido por você.

Novos códigos valem trinta minutos, aceitam maiúsculas/minúsculas, permitem cinco
erros e são consumidos uma única vez em transação. O banco guarda apenas HMAC do código,
vinculado à solicitação, usando a chave JWT com contexto próprio. O identificador
é aleatório; nenhuma resposta ao solicitante contém o código. Auditoria registra
solicitações, falhas de validação, liberações e alterações de configuração sem
códigos nem JWTs. Solicitações emitidas antes da alteração de validade mantêm
o prazo já gravado, sem extensão automática.

A autorização vale para um usuário, sessão, versão de sessão e IP, até o JWT
expirar ou o logout revogá-la. Aprovar uma sessão existente mantém sua expiração.
Uma nova aprovação em outro IP substitui a liberação anterior da mesma sessão.
Novos logins têm `jti` aleatório. Tokens antigos são identificados por SHA-256 e
recebem essa identificação como `jti` após aprovação, sem ampliar a validade.
Remover a dispensa exige código na próxima requisição em navegador não autorizado,
exceto quando a sessão já possui aprovação válida para aquele IP. Alterar a
configuração revoga todas as solicitações e aprovações temporárias anteriores.

O logout limpa os dados locais e tenta revogar a autorização no servidor. Se o
servidor estiver indisponível, a tela de login informa que não foi possível
confirmar a revogação; uma cópia do token anterior pode continuar autorizada até
expirar. Dados já enviados ao navegador e operações já iniciadas antes da troca
de rede não podem ser recolhidos pelo bloqueio; a regra é verificada no início
de cada requisição protegida. Operações recusadas não são repetidas automaticamente.

## Limites e falhas

Solicitações pendentes da mesma sessão/IP são reutilizadas; antes da emissão
do primeiro JWT, logins repetidos da mesma conta/IP reutilizam a solicitação
pendente. Há até três emissões por minuto e vinte por hora por usuário e até cem
emissões por minuto por IP. Esses limites ficam no banco e valem entre instâncias.
Login e validação também compartilham cem chamadas por minuto/IP por processo.

Falha do Telegram mantém o bloqueio, invalida a solicitação e conta na cota de
emissões, evitando tempestade de reenvios. Aguarde um minuto e tente novamente.
Não há fila nem reenvio automático. Se o Telegram aceitar a mensagem e o commit
ou a auditoria falhar, o código recebido pode não ser válido. Solicite outro,
respeitando as cotas. Acompanhe respostas 429/503 e falhas genéricas de operação.

## Contratos e testes

- `GET/PUT /api/config/admin/acesso-rede`: diagnóstico/configuração, com permissão
  `configurar_acesso_rede`. A atualização recebe `{ ativo, modo }`, com
  `modo` opcional para clientes anteriores.
- Login e requisições protegidas retornam `403 NETWORK_ACCESS_REQUIRED` com
  `solicitacao_id` e `expira_em` quando um código está pendente.
- `POST /api/auth/acesso-rede/validar`: recebe `{ solicitacao_id, codigo }` e,
  após revalidar conta, IP, horário e versão, responde `{ token, usuario }`.
- `POST /api/auth/logout`: recebe o Bearer JWT e revoga solicitações/liberações
  daquela sessão, mesmo quando o navegador ou o horário estiver bloqueado.
- O servidor do frontend deve entregar `index.html` em `/verificar-acesso`.

Os testes simulam persistência e Telegram e usam HTTP apenas em localhost.
Execute os testes direcionados de controle de acesso e autenticação, os testes
das telas e `npm run verify`. Nenhum smoke test de Telegram ou mudança em
produção faz parte da verificação automática.

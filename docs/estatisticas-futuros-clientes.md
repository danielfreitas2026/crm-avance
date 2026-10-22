# Adicionados enviados ao Telegram

Na aba Estatísticas, o cartão **Adicionados enviados ao Telegram** conta, entre os
clientes adicionados no período selecionado, os que tiveram pelo menos uma publicação
confirmada também nesse período. O cálculo cruza os IDs desses clientes depois dos
filtros de data, responsável e mailing. Não limita artificialmente o total de envios.
Assim, o cartão nunca supera **Futuros clientes adicionados** no mesmo recorte.
O mesmo cálculo atende ao total, aos agrupamentos por responsável e mailing,
ao detalhamento e à exportação Excel.

O total de todos os clientes enviados no período é apresentado separadamente abaixo
dos cartões e em outra coluna do Excel. Pode superar os adicionados, pois também
considera clientes de fora desse grupo, incluindo cadastros anteriores ou sem data de
registro preservada. Por exemplo: 66 adicionados e enviados, mais 3 clientes anteriores
enviados no período, resultam em 66 no cartão e 69 no total geral de envios.

- A confirmação exige `telegram_chat_id`, `telegram_message_id` e `publicado_em`
  válidos em `lead_telegram_publicacoes`, como no aviso “Já enviado ao Telegram”
  do detalhe do cliente.
- Entram primeiros envios, republicações e registros legados com essa confirmação.
- Cada cliente conta uma vez no período. Um reenvio de cliente adicionado antes do
  período entra apenas no total geral de envios, não no cartão dos adicionados.
- Recusas, expirações, cancelamentos e devoluções não removem confirmações anteriores.
- As datas de cadastro e publicação usam o calendário de São Paulo, com limites
  inclusivos e exclusão de datas futuras. O cadastro considera a primeira data válida
  entre o primeiro registro preservado, a marcação atual e as auditorias de marcação;
  a limpeza ou repetição da marcação não altera a data original preservada.
- O escopo continua sendo o histórico de atribuições de qualificação de mailings.
  Cada publicação fica vinculada à atribuição gravada ou à vigente na data do envio.
  Um cliente pode aparecer em mais de um responsável ou mailing; o total geral
  deduplica esses clientes e pode ser menor que a soma dos grupos.

Destino “Distribuição / Telegram”, solicitação de envio e tentativa com falha não
comprovam publicação. Registros sem mensagem identificada ou data válida não entram
no indicador. O histórico antigo só conserva parte das publicações; não é possível
reconstruir datas ausentes nem garantir que todos os envios antigos foram preservados.

A API expõe o cartão em `adicionados_enviados_telegram` e mantém o total geral de
envios em `clientes_enviados_telegram`. O campo
`novos_envios_telegram` mantém o comportamento anterior, restrito à classificação
`primeiro_envio`, para compatibilidade.

## Adicionados com venda

O cartão **Adicionados com venda** conta clientes distintos adicionados no intervalo
selecionado que atualmente satisfazem o filtro **Vendas concluídas** da lista:
`futuro_cliente = true`, sem exclusão na lixeira, e `status_operacional = vendido`
ou `venda_id` preenchido. Inclui vínculos manuais ativos e marcações legadas como
vendido. O histórico de um vínculo desfeito não basta para contar o cliente.

As datas filtram o cadastro do futuro cliente, não a criação ou conclusão da venda.
O número pode mudar depois do intervalo selecionado se uma venda for vinculada ou
desvinculada, pois representa o estado atual daquele grupo. Cada cliente conta uma
vez, mesmo se houver mais de um evento de venda no histórico. A atribuição continua
sendo à responsável pela qualificação no cadastro; o filtro de responsável atual
da lista e a vendedora da tela Vendas são critérios diferentes.

Esse estado não exige que a venda tenha alcançado a etapa final do funil: segue a
mesma definição de "Vendas concluídas" da lista de futuros clientes.

**Vendas criadas no período** e seu valor permanecem separados: usam a data de criação
da venda, deduplicam pelo ID da venda e não transformam vínculos manuais de vendas
antigas em novos resultados financeiros. Uma venda antiga vinculada a um cliente
adicionado neste período conta em **Adicionados com venda**, sem aumentar esse valor.
O Excel apresenta ambos os números.

A API expõe o cartão em `adicionados_com_venda` e preserva `vendas_registradas` e
`valor_vendido` para os eventos de criação de vendas do mailing no intervalo.

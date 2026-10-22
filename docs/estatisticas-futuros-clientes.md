# Clientes enviados ao Telegram

Na aba Estatísticas, o indicador **Clientes enviados ao Telegram** conta clientes
distintos com pelo menos uma publicação confirmada no período selecionado.
O mesmo cálculo atende ao total, aos agrupamentos por responsável e mailing,
ao detalhamento e à exportação Excel.

- A confirmação exige `telegram_chat_id`, `telegram_message_id` e `publicado_em`
  válidos em `lead_telegram_publicacoes`, como no aviso “Já enviado ao Telegram”
  do detalhe do cliente.
- Entram primeiros envios, republicações e registros legados com essa confirmação.
- Cada cliente conta uma vez no período. Um reenvio em outro período conta naquele
  período, mesmo que o primeiro envio tenha ocorrido antes.
- Recusas, expirações, cancelamentos e devoluções não removem confirmações anteriores.
- O período usa a data da publicação no calendário de São Paulo, com limites
  inclusivos e exclusão de datas futuras. Não usa a data de cadastro do cliente.
- O escopo continua sendo o histórico de atribuições de qualificação de mailings.
  Cada publicação fica vinculada à atribuição gravada ou à vigente na data do envio.
  Um cliente pode aparecer em mais de um responsável ou mailing; o total geral
  deduplica esses clientes e pode ser menor que a soma dos grupos.

Destino “Distribuição / Telegram”, solicitação de envio e tentativa com falha não
comprovam publicação. Registros sem mensagem identificada ou data válida não entram
no indicador. O histórico antigo só conserva parte das publicações; não é possível
reconstruir datas ausentes nem garantir que todos os envios antigos foram preservados.

A API expõe o indicador em `clientes_enviados_telegram`. O campo
`novos_envios_telegram` mantém o comportamento anterior, restrito à classificação
`primeiro_envio`, para compatibilidade; a tela e o Excel usam o novo indicador.

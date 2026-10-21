# Localização por DDD no mailing

Na aba de planilhas de mailing, use **Preencher Local por DDD** no card da
planilha. Marque os campos que contêm telefones completos, como terminal,
fixo e celular, e confirme. A configuração fica salva para repetir o cálculo.

O preenchimento é manual: importar uma nova planilha ou editar um telefone não
dispara o cálculo. O valor da coluna `Telefone (atualizado)`, quando existente,
tem preferência sobre `Telefone`. Telefones na mesma célula podem ser separados
por ponto e vírgula ou quebra de linha.

O resultado reúne as áreas encontradas, sem repetição. A coluna `Local` importada
é preservada: nesse caso, o sistema cria `Local por DDD` (ou um nome com sufixo
numérico se necessário). Repetir o preenchimento reutiliza a coluna criada pelo
sistema. Linhas sem telefone reconhecido recebem `Não identificado`.

O DDD identifica uma área telefônica, não o endereço atual do contato. As áreas
podem abranger vários municípios e, no caso do DDD 61, DF e GO. O catálogo usa
os Códigos Nacionais da [Anatel](https://www.gov.br/anatel/pt-br/regulado/numeracao);
os nomes exibidos são referências descritivas das áreas, não uma lista municipal.

Use **Local/DDD** para buscar e marcar várias áreas. A consulta inclui qualquer
uma das áreas marcadas e mantém os outros filtros. Os mesmos critérios são
usados na paginação, nos totais, na exportação CSV e na divisão do mailing. O
Excel individual inclui a coluna gerada. Todas as planilhas envolvidas precisam
ter o Local concluído para aplicar o filtro regional.

O progresso aparece no card. O trabalho continua se a tela for fechada; em caso
de falha ou de reinício do servidor, os dados já processados são parciais. Após
cinco minutos sem progresso, o processamento é sinalizado como interrompido.
Repita a ação para recalcular todas as linhas antes de filtrar por região.

## Integração e implantação

- Aplicar a migration `20261020120000_add_local_ddd_mailing` antes de iniciar
  esta versão. A migration só acrescenta campos; não preenche as planilhas.
- `GET /api/lead-planilhas/locais`: catálogo `{ ddd, area, uf, label }`.
- `POST /api/lead-planilhas/:id/local`: corpo `{ campos: ["Terminal", "Fixo"] }`;
  retorna HTTP 202 e a planilha com `local_config`.
- `GET /api/lead-planilhas/:id/status`: acompanha `local_config.status`,
  `processadas`, `identificadas`, `total` e `erro`.
- Catálogo, início e status exigem `gerenciar_leads`. O início é auditado sem
  registrar os telefones.
- Filtros: `local_ddds` (array no corpo ou lista separada por vírgulas na URL)
  e `local_nao_identificado` (booleano). Áreas e não identificados são combinados
  com OU. Uma planilha com Local incompleto causa HTTP 409.
- Processamento em lotes de 500, com bloqueio transacional da planilha e das
  linhas. A identificação da execução impede um worker antigo de escrever
  sobre uma nova tentativa. Nenhuma API externa é consultada.
- O rollback remove os metadados novos, preservando os textos gerados e os
  dados originais em `dados_json`. Não executar rollback durante preenchimentos.

## Arquivos da implementação

- Backend: `backend/src/utils/ddd.js`, `backend/src/services/lead-local.service.js`,
  `backend/src/services/lead-planilha.service.js`,
  `backend/src/controllers/lead-planilha.controller.js`,
  `backend/src/routes/lead-planilha.routes.js`, `backend/src/models/LeadPlanilha.js`
  e `backend/src/models/LeadLinha.js`.
- Migração: `backend/src/database/migrations/20261020120000_add_local_ddd_mailing.js`.
- Frontend: `frontend/src/pages/AdminLeadsPage/AdminLeadsPage.jsx`,
  `frontend/src/pages/AdminLeadsPage/LocalMailing.jsx`,
  `frontend/src/pages/AdminLeadsPage/LocalMailing.css` e
  `frontend/src/services/lead-planilha.service.js`.
- Regressão: `backend/test/ddd-local.test.js`, `backend/test/lead-local.test.js`,
  `frontend/src/pages/AdminLeadsPage/LocalMailing.test.jsx` e
  `frontend/src/services/lead-planilha.service.test.js`.
- Documentação: este arquivo.

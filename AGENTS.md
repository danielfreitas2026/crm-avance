# Regras de desenvolvimento do CRM Avance

Estas instrucoes se aplicam a todo o repositorio e devem ser seguidas por qualquer pessoa ou agente de IA que altere o projeto.

## Antes de editar

- Leia a implementacao atual e identifique consumidores, rotas, servicos, modelos, componentes e testes relacionados.
- Registre os comportamentos e contratos que precisam continuar funcionando.
- Confira `git status` e preserve todas as alteracoes preexistentes do usuario.
- Nunca abra, exiba, copie ou modifique segredos presentes em arquivos `.env`, `.env.servidor`, `.env.producao` ou equivalentes. Use apenas `.env.example` para entender nomes de variaveis.

## Durante a alteracao

- Faca a menor mudanca capaz de atender ao objetivo.
- Nao misture funcionalidade nova, correcao de bug e refatoracao no mesmo trabalho, salvo quando forem tecnicamente inseparaveis e isso for explicado.
- Para todo bug corrigido ou comportamento alterado, adicione ou atualize um teste de regressao que falhe sem a mudanca e passe com ela.
- Rode primeiro os testes diretamente relacionados para obter retorno rapido.
- Nunca use banco de dados, credenciais, endpoints ou servicos de producao em testes.
- A suite automatica permite somente conexoes de rede com localhost. Nao enfraqueca ou contorne essa protecao para fazer um teste passar.
- Scripts manuais de smoke test de integracoes nao fazem parte de `npm run verify` e so devem ser executados por solicitacao explicita.
- Nunca altere uma migration que ja possa ter sido aplicada. Crie uma nova migration para evoluir o banco.

## Antes de concluir

- Rode `npm run verify` na raiz do repositorio.
- Revise o diff completo para encontrar mudancas acidentais, codigo morto, segredos e arquivos gerados.
- Informe os arquivos alterados, os riscos conhecidos, os testes executados e os respectivos resultados.
- Diferencie claramente falhas introduzidas pela mudanca de falhas que ja existiam na linha de base.
- Nao declare o trabalho concluido se uma verificacao nova falhar, exceto quando a falha for preexistente e estiver explicitamente documentada abaixo.

## Comandos de verificacao

- `npm run test:backend`: executa os testes do backend.
- `npm run test:frontend`: executa os testes do frontend uma unica vez.
- `npm run lint:frontend`: executa a analise estatica do frontend.
- `npm run build:frontend`: gera o build do frontend sem instalar dependencias.
- `npm run verify`: executa, em sequencia, testes do backend, testes do frontend, lint e build do frontend.

## Linha de base conhecida

Estado registrado antes da introducao do `npm run verify`:

- Backend: 295 testes passando.
- Frontend: 33 arquivos de teste e 170 testes passando.
- Build do frontend: passando, com aviso nao bloqueante de bundle superior a 500 kB.
- Lint do frontend: zero erros e zero avisos; avisos agora tambem bloqueiam a verificacao.

O lint deve permanecer sem supressoes inline destinadas apenas a contornar regras. Qualquer novo erro ou aviso deve ser corrigido antes da conclusao do trabalho.

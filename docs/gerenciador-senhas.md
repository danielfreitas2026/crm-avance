# Gerenciador de senhas

Todos os administradores ativos podem consultar individualmente as senhas,
inclusive de outros administradores, em `/admin/senhas`. Uma sessão administrativa
comprometida pode revelar essas credenciais. Cada revelação exige a gravação de
auditoria com administrador e usuário consultado; a senha não é registrada no histórico.

## Implantação

1. Aplique a nova migration com o processo habitual (`npm run migrate`).
2. Gere uma chave exclusiva: `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`.
3. Configure `CRM_PASSWORD_VAULT_KEY` nas variáveis seguras do servidor, antes de
   disponibilizar a versão. Não reutilize o segredo JWT nem coloque a chave no frontend.
4. Conserve a chave em backup seguro, separado do banco. Não publique a saída do comando.

Perder ou substituir a chave impede consultar as cópias anteriores. Esta versão não
implementa rotação de chaves: uma rotação exige um procedimento próprio de recriptografia
usando a chave anterior antes da substituição. As senhas de login continuam verificadas
por bcrypt. Sem chave válida, novos cadastros e trocas de senha retornam 503 sem gravar;
login e edições sem senha continuam funcionando.

As contas existentes ficam com “Senha indisponível até a próxima troca”. A cópia
AES-256-GCM é produzida apenas em cadastro e alterações explícitas de senha, nunca
durante login. Alterações pelo perfil ou por um administrador atualizam hash e cópia
na mesma gravação. O seed administrativo limpa a cópia quando redefine a senha.

O navegador guarda a senha revelada somente em memória, por até 30 segundos, e a
remove ao ocultar, sair da página, encerrar a sessão ou colocar a aba em segundo plano.
As consultas usam `Cache-Control: no-store` e não oferecem exportação em lote.

## Verificação

Os testes usam uma chave fictícia exclusiva do ambiente de teste e conexões somente
com localhost. Execute os testes relacionados e depois `npm run verify`.

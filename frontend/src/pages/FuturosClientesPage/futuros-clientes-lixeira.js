import { temPermissao } from '../../services/auth.service';

export function resolverAcessoLixeiraFuturosClientes(usuario, { escopoTodos = false, modoRecebidos = false } = {}) {
  const podeAtuarNoEscopo = !escopoTodos || temPermissao(usuario, 'futuros_clientes_gerenciar_todos');
  const podeEnviarLixeira = !modoRecebidos
    && podeAtuarNoEscopo
    && temPermissao(usuario, 'futuros_clientes_enviar_lixeira');
  const podeExcluirDefinitivamente = !modoRecebidos
    && podeAtuarNoEscopo
    && temPermissao(usuario, 'futuros_clientes_excluir_definitivamente');

  return {
    podeEnviarLixeira,
    podeExcluirDefinitivamente,
    podeAcessarLixeira: podeEnviarLixeira || podeExcluirDefinitivamente
  };
}


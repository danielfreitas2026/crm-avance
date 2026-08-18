import { temPermissao } from '../../services/auth.service';

const PERMISSOES_VENDAS = ['vendas', 'vendas_ver_proprias', 'vendas_ver_todas', 'vendas_criar', 'vendas_editar', 'vendas_excluir'];
const PERMISSOES_CLIENTES = ['clientes_ver_proprios', 'clientes_ver_todos', 'clientes_criar', 'clientes_importar_planilhas', 'clientes_editar', 'clientes_excluir'];
const PERMISSOES_CLIENTES_SECRETOS = ['clientes_secretos_ver', 'clientes_secretos_ver_todos'];
const PERMISSOES_FUTUROS_CLIENTES = ['futuros_clientes_ver', 'vendas_criar'];
const PERMISSOES_RETORNOS = ['vendas_ver_proprias', 'vendas_ver_todas', 'ver_vendas_compartilhadas'];

function dadosNotificacao(notificacao) {
  if (!notificacao?.dados) return {};
  if (typeof notificacao.dados === 'object') return notificacao.dados;
  try {
    return JSON.parse(notificacao.dados) || {};
  } catch {
    return {};
  }
}

function montarRota(pathname, parametros) {
  const query = new URLSearchParams();
  Object.entries(parametros || {}).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') query.set(chave, String(valor));
  });
  const texto = query.toString();
  return texto ? `${pathname}?${texto}` : pathname;
}

function destino(pathname, parametros, permissao, permissaoDescricao, idObrigatorio) {
  if (!idObrigatorio) {
    return { rota: null, permissao, permissaoDescricao, motivoTipo: 'destino_invalido', motivo: 'O alerta não possui mais uma referência válida para abrir.' };
  }
  return { rota: montarRota(pathname, parametros), permissao, permissaoDescricao };
}

export function montarDestinoNotificacao(notificacao) {
  const dados = dadosNotificacao(notificacao);
  const entidadeId = notificacao?.entidade_id || dados.entidade_id || '';
  const vendaId = dados.venda_id || (notificacao?.entidade === 'vendas' ? entidadeId : '');
  const clienteId = dados.cliente_id || (notificacao?.entidade === 'clientes' ? entidadeId : '');
  const linhaId = dados.lead_linha_id || (notificacao?.entidade === 'lead_linhas' ? entidadeId : '');
  const notificacaoId = notificacao?.id || '';
  const comum = { notificacao_id: notificacaoId };

  switch (notificacao?.tipo) {
    case 'futuro_cliente_distribuido':
    case 'futuro_cliente_retorno_pre':
    case 'futuro_cliente_retorno_due':
      return destino('/futuros-clientes', { ...comum, linha_id: linhaId }, PERMISSOES_FUTUROS_CLIENTES, 'acesso a Futuros Clientes', linhaId);
    case 'lead_retorno_pre':
    case 'lead_retorno_due':
      return destino('/futuros-clientes', { ...comum, aba: 'leads', linha_id: linhaId }, PERMISSOES_FUTUROS_CLIENTES, 'acesso aos leads', linhaId);
    case 'venda_problema_aberto':
    case 'venda_problema_resolvido':
    case 'venda_problema_correcao':
      return destino('/vendas', { ...comum, venda_id: vendaId, aba: 'problema', problema_id: dados.problema_id }, PERMISSOES_VENDAS, 'acesso a Vendas', vendaId);
    case 'venda_aprovacao_pendente':
      return destino('/vendas/aprovacoes', { ...comum, solicitacao_id: dados.solicitacao_id }, 'vendas_aprovacoes_visualizar', 'visualização de aprovações', dados.solicitacao_id);
    case 'venda_parada_funil':
      return destino('/funil', { ...comum, venda_id: vendaId }, 'funil_vendas', 'acesso ao Funil de Vendas', vendaId);
    case 'venda_retorno_registrado':
      return destino('/retornos', { ...comum, venda_id: vendaId }, PERMISSOES_RETORNOS, 'acesso aos retornos de vendas', vendaId);
    case 'cliente_fidelidade':
      return destino('/clientes', { ...comum, cliente_id: clienteId, aba: 'cliente' }, PERMISSOES_CLIENTES, 'acesso a Clientes', clienteId);
    case 'nota_retorno_pre':
    case 'nota_retorno_due':
      if (notificacao.entidade === 'clientes-secretos' || dados.entidade_tipo === 'lead') {
        return destino('/clientes-secretos', { ...comum, cliente_id: entidadeId, aba: 'notas' }, PERMISSOES_CLIENTES_SECRETOS, 'acesso aos leads qualificados', entidadeId);
      }
      if (notificacao.entidade === 'clientes' || dados.entidade_tipo === 'cliente') {
        return destino('/clientes', { ...comum, cliente_id: clienteId || entidadeId, aba: 'notas' }, PERMISSOES_CLIENTES, 'acesso a Clientes', clienteId || entidadeId);
      }
      return destino('/vendas', { ...comum, venda_id: vendaId || entidadeId, aba: 'notas' }, PERMISSOES_VENDAS, 'acesso a Vendas', vendaId || entidadeId);
    default:
      if (notificacao?.entidade === 'vendas') {
        return destino('/vendas', { ...comum, venda_id: vendaId }, PERMISSOES_VENDAS, 'acesso a Vendas', vendaId);
      }
      if (notificacao?.entidade === 'clientes') {
        return destino('/clientes', { ...comum, cliente_id: clienteId, aba: 'cliente' }, PERMISSOES_CLIENTES, 'acesso a Clientes', clienteId);
      }
      return { rota: null, motivoTipo: 'destino_invalido', motivo: 'Este tipo de alerta não possui uma ação de abertura configurada.' };
  }
}

export function resolverDestinoNotificacao(notificacao, usuario) {
  const resultado = montarDestinoNotificacao(notificacao);
  if (!resultado.rota) return { ...resultado, podeAbrir: false };
  if (!temPermissao(usuario, resultado.permissao)) {
    return {
      ...resultado,
      podeAbrir: false,
      motivoTipo: 'sem_permissao',
      motivo: `Você recebeu este alerta, mas precisa de ${resultado.permissaoDescricao} para abrir o registro.`
    };
  }
  return { ...resultado, podeAbrir: true };
}

const SENSIVEL = /senha|password|token|authorization|jwt|(?:^|[._])secret(?:$|[._])|api_key|foto_perfil/i;

export function formatarCampoHistorico(campo = '') {
  const labels = {
    data_venda: 'Data da venda', valor_total: 'Valor total', valor_unitario: 'Valor unitário',
    quantidade: 'Quantidade', quantidade_linhas: 'Quantidade de linhas', status_funil: 'Etapa do funil',
    prioridade_funil: 'Prioridade', razao_social: 'Razão social', nome_fantasia: 'Nome fantasia',
    email: 'E-mail', cnpj: 'CNPJ', cpf: 'CPF', id: 'ID', observacao: 'Observação',
    operadoras_atuais: 'Operadoras atuais', consultora_ids: 'Consultoras (IDs)',
    vendedoras: 'Vendedoras (IDs)', vendedora_id: 'Vendedora (ID)', operadora_id: 'Operadora (ID)',
    cliente_id: 'Cliente (ID)', role_id: 'Perfil de acesso (ID)', permissoes: 'Permissões'
  };
  return campo.split('.').map(parte => {
    const match = /^(.*)\[(\d+)\]$/.exec(parte);
    if (match) {
      const titulo = match[1] === 'valores_unitarios_chips' ? 'Chip' : formatarCampoHistorico(match[1]);
      return `${titulo} ${Number(match[2]) + 1}`;
    }
    return labels[parte] || parte.replaceAll('_', ' ').replace(/\b\w/g, letra => letra.toUpperCase());
  }).join(' · ');
}

function objeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor);
}

/** Adapta registros antigos sem inventar valores anteriores ou alterações confirmadas. */
export function obterAlteracoesHistorico(dados = {}) {
  let linhas;
  let legado = false;
  if (Array.isArray(dados.alteracoes_detalhadas)) linhas = dados.alteracoes_detalhadas;
  else if (Array.isArray(dados.alteracoes)) linhas = dados.alteracoes;
  else {
    legado = true;
    linhas = [];
    const conhecidos = new Set();
    const movimentacao = dados.movimentacao || {};
    const statusAnterior = Object.hasOwn(movimentacao, 'status_anterior') ? movimentacao.status_anterior
      : Object.hasOwn(dados, 'status_anterior') ? dados.status_anterior : dados.alteracoes?.status_anterior;
    const statusNovo = Object.hasOwn(movimentacao, 'status_novo') ? movimentacao.status_novo
      : Object.hasOwn(dados, 'status_novo') ? dados.status_novo : dados.alteracoes?.status_funil;
    if (statusAnterior !== undefined && statusNovo !== undefined) {
      if (statusAnterior !== statusNovo) linhas.push({ campo: 'status_funil', anterior: statusAnterior, novo: statusNovo });
      conhecidos.add('status_anterior'); conhecidos.add('status_funil');
    }
    if (Object.hasOwn(dados, 'prioridade_anterior') && Object.hasOwn(dados, 'prioridade_nova') && dados.prioridade_anterior !== dados.prioridade_nova) {
      linhas.push({ campo: 'prioridade_funil', anterior: dados.prioridade_anterior, novo: dados.prioridade_nova });
      conhecidos.add('prioridade_funil');
    }
    if (Object.hasOwn(dados, 'concluida_em_anterior') && Object.hasOwn(dados, 'concluida_em')) {
      linhas.push({ campo: 'concluida_em', anterior: dados.concluida_em_anterior, novo: dados.concluida_em });
    }
    function visitar(campos, prefixo = '') {
      for (const [chave, valor] of Object.entries(campos)) {
        if (!prefixo && conhecidos.has(chave)) continue;
        const campo = prefixo ? `${prefixo}.${chave}` : chave;
        if (objeto(valor) && Object.hasOwn(valor, 'anterior') && Object.hasOwn(valor, 'novo')) {
          linhas.push({ campo, anterior: valor.anterior, novo: valor.novo });
        } else if (objeto(valor)) visitar(valor, campo);
        else linhas.push({ campo, novo: valor, anterior_registrado: false });
      }
    }
    if (objeto(dados.alteracoes)) visitar(dados.alteracoes);
  }
  return { legado, linhas: (linhas || []).filter(item => item && typeof item.campo === 'string').map(item => {
    const protegido = Boolean(item.protegido || SENSIVEL.test(item.campo));
    return {
      ...item, protegido,
      anterior_registrado: item.anterior_registrado !== false && Object.hasOwn(item, 'anterior'),
      anterior: protegido ? '[removido]' : item.anterior,
      novo: protegido ? '[removido]' : item.novo
    };
  }) };
}

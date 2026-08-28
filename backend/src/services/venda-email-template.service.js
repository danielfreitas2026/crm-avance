/**
 * Servico de montagem de templates de e-mail para vendas.
 */
function texto(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

/**
 * Normaliza texto para uso interno consistente.
 */
function normalizarTexto(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Retorna linha no formato esperado pelo fluxo.
 */
function linha(label, value) {
  const valor = texto(value);
  return valor ? `${label} : ${valor}` : `${label} :`;
}

/**
 * Normaliza telefone para exibicao ou envio.
 */
function telefone(numero) {
  let valor = texto(numero);
  if (valor.startsWith('+55')) valor = valor.slice(3);
  return valor.replace(/[()\-\s]/g, '');
}

/**
 * Normaliza CNPJ para exibicao ou envio.
 */
function cnpj(valor) {
  return texto(valor).replace(/\D/g, '');
}

/**
 * Formata moeda para exibicao ou envio.
 */
function formatarMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = parseNumero(valor);

  if (!Number.isFinite(numero)) return texto(valor);

  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Formata decimal para exibicao ou envio.
 */
function formatarDecimal(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';

  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formata data para exibicao ou envio.
 */
function formatarData(valor) {
  const raw = texto(valor);
  if (!raw) return '';

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  return raw;
}

/**
 * Combina documento e data de nascimento sem criar separadores vazios.
 */
function documentoComNascimento(documento, nascimento, rotuloNascimento = 'DN') {
  const documentoTexto = texto(documento);
  const nascimentoTexto = formatarData(nascimento);

  if (documentoTexto && nascimentoTexto) {
    return `${documentoTexto} / ${rotuloNascimento}: ${nascimentoTexto}`;
  }

  if (nascimentoTexto) return `${rotuloNascimento}: ${nascimentoTexto}`;
  return documentoTexto;
}

/**
 * Converte numero para o formato interno esperado.
 */
function parseNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

  const raw = String(valor).replace(/\s/g, '').replace(/^R\$/i, '');
  const temVirgula = raw.includes(',');
  const temPonto = raw.includes('.');
  let normalizado = raw;

  if (temVirgula && temPonto) {
    normalizado = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = raw.replace(',', '.');
  } else if (temPonto) {
    const partes = raw.split('.');
    const ultimaParte = partes[partes.length - 1];
    normalizado = partes.length === 2 && ultimaParte.length <= 2
      ? raw
      : raw.replace(/\./g, '');
  }

  const numero = Number(normalizado);

  return Number.isFinite(numero) ? numero : 0;
}

/**
 * Converte itens chips para o formato interno esperado.
 */
function parseItensChips(valor, gbPadrao = '') {
  if (!valor) return [];

  if (Array.isArray(valor)) {
    return valor
      .map(item => ({
        quantidade: Number(item.quantidade || 0),
        gb: texto(item.gb || gbPadrao),
        tipoLinha: normalizarTipoLinhaChip(item.tipo_linha || item.tipo || item.categoria),
        ...(item.operadora_atual_id ? { operadoraAtualId: Number(item.operadora_atual_id) } : {}),
        ...(item.operadora_atual_nome ? { operadoraAtualNome: texto(item.operadora_atual_nome) } : {}),
        ...(item.operadora_id ? { operadoraId: Number(item.operadora_id) } : {}),
        ...(item.operadora_nome ? { operadoraNome: texto(item.operadora_nome) } : {}),
        valorUnitario: parseNumero(item.valor_unitario)
      }))
      .filter(item => item.quantidade > 0);
  }

  if (typeof valor === 'string') {
    try {
      return parseItensChips(JSON.parse(valor), gbPadrao);
    } catch {
      return valor
        .split(/\r?\n|\/+/)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          const match = item.match(/^(\d+)\s*x\s*([\d.,]+)/i);
          if (!match) return null;
          return {
            quantidade: Number(match[1]),
            gb: texto(gbPadrao),
            tipoLinha: 'novo',
            valorUnitario: parseNumero(match[2])
          };
        })
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Normaliza tipo linha chip para uso interno consistente.
 */
function normalizarTipoLinhaChip(valor) {
  const tipo = normalizarTexto(valor);
  return tipo.includes('porta') ? 'portabilidade' : 'novo';
}

/**
 * Converte portados para o formato interno esperado.
 */
function parsePortados(valor) {
  if (!valor) return [];

  if (Array.isArray(valor)) {
    return valor.map(texto).filter(Boolean);
  }

  if (typeof valor === 'string') {
    try {
      return parsePortados(JSON.parse(valor));
    } catch {
      return valor
        .split(/\r?\n|[,;]/)
        .map(item => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * Retorna quantidade linhas no formato esperado pelo fluxo.
 */
function quantidadeLinhas(venda, itens) {
  const qtdVenda = Number(venda.quantidade_linhas || 0);
  if (qtdVenda > 0) return qtdVenda;

  const qtdItens = itens.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  return qtdItens > 0 ? qtdItens : 0;
}

/**
 * Retorna preco unitario padrao no formato esperado pelo fluxo.
 */
function precoUnitarioPadrao(venda, qtd) {
  if (!qtd) return '';
  const total = parseNumero(venda.valor_total);
  if (!total) return '';

  return formatarDecimal(total / qtd);
}

/**
 * Retorna valor total no formato esperado pelo fluxo.
 */
function valorTotal(venda) {
  return formatarMoeda(venda.valor_total);
}

/**
 * Retorna gb com sufixo no formato esperado pelo fluxo.
 */
function gbComSufixo(valor) {
  const gb = texto(valor);
  if (!gb) return '';
  return /gb$/i.test(gb) ? gb : `${gb}GB`;
}

/**
 * Retorna nome cliente no formato esperado pelo fluxo.
 */
function nomeCliente(venda) {
  return texto(venda.razao_social || venda.cliente?.razao_social || venda.cliente?.nome || venda.nome);
}

/**
 * Retorna nome vendedora no formato esperado pelo fluxo.
 */
function nomeVendedora(venda) {
  return texto(venda.vendedora?.nome);
}

/**
 * Retorna endereco receita no formato esperado pelo fluxo.
 */
function enderecoReceita(venda, campo) {
  return texto(venda[campo]);
}

/**
 * Monta contexto a partir dos dados informados.
 */
function montarContexto(venda) {
  const itens = parseItensChips(venda.valores_unitarios_chips, venda.gb);
  const portados = parsePortados(venda.numeros_portados);
  const qtd = quantidadeLinhas(venda, itens);
  const qtdPortabilidadeItens = itens.reduce((total, item) => (
    item.tipoLinha === 'portabilidade' ? total + Number(item.quantidade || 0) : total
  ), 0);
  const qtdPortados = Math.max(portados.length, qtdPortabilidadeItens);

  return {
    itens,
    portados,
    qtd,
    qtdPortados,
    qtdNovas: Math.max(0, qtd - qtdPortados),
    precoUnitario: precoUnitarioPadrao(venda, qtd),
    cliente: nomeCliente(venda),
    vendedora: nomeVendedora(venda)
  };
}

/**
 * Resolve a pessoa escolhida para confirmar o aceite da venda.
 */
function pessoaConfirmacao(venda) {
  const valorInformado = texto(venda.nome_fechou_venda);
  const valorNormalizado = normalizarTexto(valorInformado);
  const pessoas = [
    {
      aliases: ['rl', 'representante legal'],
      nome: texto(venda.nome_representante_legal),
      cpf: texto(venda.cpf_representante_legal),
      rg: texto(venda.rg_representante_legal),
      nascimento: formatarData(venda.data_nascimento_representante_legal),
      telefone: telefone(venda.telefone_representante_legal)
    },
    {
      aliases: ['adm', 'administrador'],
      nome: texto(venda.nome_administrador),
      cpf: texto(venda.cpf_administrador),
      rg: texto(venda.rg_administrador),
      nascimento: formatarData(venda.data_nascimento_administrador),
      telefone: telefone(venda.telefone_administrador)
    }
  ];

  const encontrada = pessoas.find(pessoa => (
    pessoa.aliases.includes(valorNormalizado)
    || (pessoa.nome && normalizarTexto(pessoa.nome) === valorNormalizado)
  ));

  return encontrada || {
    nome: valorInformado,
    cpf: '',
    rg: '',
    nascimento: '',
    telefone: ''
  };
}

/**
 * Lista movimentos distintos entre operadoras no formato do checklist Vivo.
 */
function movimentosOperadora(venda, ctx) {
  const movimentos = [];
  const chaves = new Set();

  function adicionar(origem, destino) {
    const origemTexto = texto(origem);
    const destinoTexto = texto(destino);
    if (!origemTexto || !destinoTexto) return;

    const chave = `${normalizarTexto(origemTexto)}|${normalizarTexto(destinoTexto)}`;
    if (normalizarTexto(origemTexto) === normalizarTexto(destinoTexto) || chaves.has(chave)) return;

    chaves.add(chave);
    movimentos.push(`${origemTexto.toLowerCase()} para ${destinoTexto.toLowerCase()}`);
  }

  ctx.itens.forEach(item => {
    adicionar(item.operadoraAtualNome, item.operadoraNome || venda.operadora?.nome);
  });

  if (movimentos.length === 0) {
    adicionar(venda.operadoraAtual?.nome, venda.operadora?.nome);
  }

  return movimentos;
}

/**
 * Formata plano claro para exibicao ou envio.
 */
function formatarPlanoClaro(venda, ctx) {
  if (ctx.itens.length > 0) {
    return ctx.itens
      .map(item => {
        const gbTexto = item.gb || venda.gb
          ? gbComSufixo(item.gb || venda.gb)
          : texto(venda.produto_fechado);
        const preco = item.valorUnitario ? formatarDecimal(item.valorUnitario) : ctx.precoUnitario;
        return preco
          ? `CLARO PÓS ${gbTexto} (${item.quantidade}X${preco})`
          : `CLARO PÓS ${gbTexto}`;
      })
      .join(' + ');
  }

  const gbTexto = venda.gb ? gbComSufixo(venda.gb) : texto(venda.produto_fechado);
  return ctx.precoUnitario
    ? `CLARO PÓS ${gbTexto} (${ctx.qtd}X${ctx.precoUnitario})`
    : `CLARO PÓS ${gbTexto}`.trim();
}

/**
 * Renderiza claro no fluxo da tela.
 */
function renderClaro(venda) {
  const ctx = montarContexto(venda);
  const plano = `${formatarPlanoClaro(venda, ctx)}${venda.ddd ? `  - DDD ${venda.ddd}` : ''}`;

  return [
    `VENDA ${ctx.vendedora} - ${ctx.cliente}`,
    '',
    'CLARO',
    '',
    `DATA DA VENDA: ${formatarData(venda.data_venda)}`,
    `Consultor: ${ctx.vendedora}`,
    `CLIENTE: ${ctx.cliente}`,
    `CNPJ: ${cnpj(venda.cnpj || venda.cliente?.cnpj)}`,
    'ENDEREÇO:',
    `Logradouro: ${enderecoReceita(venda, 'endereco')}    Número: ${enderecoReceita(venda, 'numero_endereco')}    Complemento: ${enderecoReceita(venda, 'complemento')}`,
    `CEP: ${enderecoReceita(venda, 'cep')}   Bairro: ${enderecoReceita(venda, 'bairro')}   Município: ${enderecoReceita(venda, 'municipio')}   UF: ${enderecoReceita(venda, 'uf')}`,
    `PONTO DE REFERÊNCIA: ${texto(venda.ponto_referencia)}`,
    `RESPONSÁVEL: ${texto(venda.nome_representante_legal)}`,
    `CPF: ${texto(venda.cpf_representante_legal)}`,
    `Melhor horário para fazer aceite de voz: ${texto(venda.horario_aceite_voz)}`,
    `Telefone: ${telefone(venda.telefone)}`,
    `Telefone: ${telefone(venda.fixo_ddd)}`,
    `EMAIL: ${texto(venda.email_representante_legal)}`,
    `PLANO: ${plano}`,
    `TOTAL: ${valorTotal(venda)}`,
    '',
    'Docs ok',
    '',
    `OBS CONSULTOR: ${texto(venda.observacoes)}`,
    `LOGIN: ${texto(venda.login)}   SENHA: ${texto(venda.senha)}   PROTOCOLO: ${texto(venda.protocolo)}`
  ].join('\n');
}

/**
 * Retorna plano vivo no formato esperado pelo fluxo.
 */
function planoVivo(venda, ctx) {
  if (ctx.itens.length > 0) {
    const gbParts = ctx.itens.map(item => {
      const gb = gbComSufixo(item.gb || venda.gb);
      return `VIVO ${gb}`.trim();
    });
    const priceParts = ctx.itens.map(item => {
      const preco = item.valorUnitario ? formatarDecimal(item.valorUnitario) : ctx.precoUnitario;
      return preco ? `${item.quantidade}X${preco}` : '';
    }).filter(Boolean);

    return `${gbParts.join(' + ')}${priceParts.length ? ` - ${priceParts.join(' + ')}` : ''}${venda.ddd ? ` - DDD ${venda.ddd}` : ''}`;
  }

  const partes = [`VIVO ${gbComSufixo(venda.gb)}`.trim()];
  if (ctx.qtd && ctx.precoUnitario) partes.push(`${ctx.qtd}X${ctx.precoUnitario}`);
  if (venda.ddd) partes.push(`DDD ${venda.ddd}`);

  return partes.length > 1 ? partes.join(' - ') : '';
}

/**
 * Renderiza vivo no fluxo da tela.
 */
function renderVivo(venda) {
  const ctx = montarContexto(venda);
  const confirmacao = pessoaConfirmacao(venda);
  const linhaNova = ctx.qtdNovas && ctx.precoUnitario ? `${ctx.qtdNovas}x${ctx.precoUnitario}` : 'X';
  const portabilidadeBase = ctx.qtdPortados && ctx.precoUnitario ? `${ctx.qtdPortados}x${ctx.precoUnitario}` : '';
  const portabilidade = [portabilidadeBase, ctx.portados.join(', ')].filter(Boolean).join('-') || 'X';
  const nomeConfirmacao = confirmacao.nascimento
    ? `${confirmacao.nome} - dn: ${confirmacao.nascimento}`.trim()
    : confirmacao.nome;
  const movimentos = movimentosOperadora(venda, ctx);

  return [
    `VENDA ${ctx.vendedora} - ${ctx.cliente}`,
    '',
    'Segue Checklist Pedidos Móvel Vivo',
    '',
    'PEDIDO 1 ACEITE MÓVEL',
    '',
    linha('RAZAO SOCIAL', ctx.cliente),
    linha('CNPJ', cnpj(venda.cnpj || venda.cliente?.cnpj)),
    linha('REPRESENTANTE LEGAL', venda.nome_representante_legal),
    linha('CPF REPRESENTANTE LEGAL', documentoComNascimento(
      venda.cpf_representante_legal,
      venda.data_nascimento_representante_legal
    )),
    linha('RG', venda.rg_representante_legal),
    linha('EMAIL PARA ENVIO ACEITE', venda.email_representante_legal),
    linha('TELEFONE', confirmacao.telefone || telefone(venda.telefone) || telefone(venda.fixo_ddd)),
    linha('CONFIRMAÇÃO FALAR COM', nomeConfirmacao),
    linha('rg', confirmacao.rg),
    linha('CPF', confirmacao.cpf),
    linha('ENDEREÇO', enderecoReceita(venda, 'endereco') || venda.ponto_referencia || venda.tipo_local_cpf),
    linha('LINHA NOVA', linhaNova),
    linha('PORTABILIDADE', portabilidade),
    linha('LINHA COM DDD X PLANO', planoVivo(venda, ctx)),
    ...movimentos,
    linha('VALOR TOTAL NEGOCIADO', valorTotal(venda)),
    '',
    linha('VENCIMENTO', venda.dia_vencimento),
    linha('OBSERVAÇÃO', venda.observacoes)
  ].join('\n');
}

/**
 * Resolve operadora a partir do contexto atual.
 */
function resolverOperadora(venda) {
  const nome = texto(venda.operadora?.nome);
  const normalizado = normalizarTexto(nome);

  if (normalizado.includes('claro')) return 'Claro';
  if (normalizado.includes('vivo')) return 'Vivo';

  return null;
}

/**
 * Renderiza email venda no fluxo da tela.
 */
function renderEmailVenda(venda) {
  const operadora = resolverOperadora(venda);

  if (!operadora) {
    const error = new Error('Operadora sem template de email. Use Claro ou Vivo.');
    error.statusCode = 400;
    throw error;
  }

  return {
    operadora,
    texto: operadora === 'Claro' ? renderClaro(venda) : renderVivo(venda)
  };
}

module.exports = {
  renderEmailVenda,
  _internals: {
    parseItensChips,
    parsePortados,
    resolverOperadora
  }
};

const axios = require('axios');

const TELEGRAM_API_URL = 'https://api.telegram.org';

function tokenConfigurado() {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

async function chamarApi(metodo, dados) {
  const token = tokenConfigurado();
  return chamarApiComToken(token, metodo, dados);
}

/**
 * Chama a API do Telegram com o token informado.
 */
async function chamarApiComToken(token, metodo, dados) {
  if (!token) return null;
  try {
    const resposta = await axios.post(`${TELEGRAM_API_URL}/bot${token}/${metodo}`, dados, { timeout: 10000 });
    if (!resposta.data?.ok) throw new Error(resposta.data?.description || 'O Telegram recusou a solicitacao.');
    return resposta.data.result;
  } catch (error) {
    throw new Error(error.response?.data?.description || error.message || 'Falha ao chamar o Telegram.');
  }
}

function formatarMoeda(valor) {
  const número = Number(valor);
  if (!Number.isFinite(número)) return 'Não informado';
  return número.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataHora(valor) {
  if (!valor) return 'Não informado';
  const texto = String(valor);
  const dataSemHora = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dataSemHora) return `${dataSemHora[3]}/${dataSemHora[2]}/${dataSemHora[1]}`;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return texto;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(data);
}

function formatarTelefone(numero) {
  if (!numero) return 'Não informado';
  const digitos = String(numero).replace(/\D/g, '');
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  return String(numero);
}

function obterChatId(nomeVariavel) {
  return String(process.env[nomeVariavel] || '').trim();
}

function normalizarItensChips(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  try {
    const itens = JSON.parse(valor);
    return Array.isArray(itens) ? itens : [];
  } catch {
    return [];
  }
}

function valorInformado(valor) {
  if (valor === null || valor === undefined || valor === '') return 'Não informado';
  return String(valor);
}

function formatarBooleano(valor) {
  if (valor === null || valor === undefined || valor === '') return 'Não informado';
  return valor === true || Number(valor) === 1 ? 'Sim' : 'Não';
}

function parseJson(valor, fallback) {
  if (valor && typeof valor === 'object') return valor;
  if (!valor) return fallback;
  try { return JSON.parse(valor); } catch { return fallback; }
}

function formatarLista(valor) {
  const parseado = Array.isArray(valor) ? valor : parseJson(valor, null);
  const lista = Array.isArray(parseado) ? parseado : String(valor || '').split(/[\n,]+/);
  const itens = (Array.isArray(lista) ? lista : []).map(item => String(item || '').trim()).filter(Boolean);
  return itens.length ? itens.join(', ') : 'Não informado';
}

function formatarServicosSolicitados(venda) {
  const labels = { bloqueio: 'Bloqueio', cancelamento: 'Cancelamento', nenhum_servico: 'Nenhum serviço' };
  const itens = parseJson(venda.cliente_solicitou_servicos, []);
  return Array.isArray(itens) && itens.length
    ? itens.map(item => labels[item] || item).join(', ')
    : 'Não informado';
}

function formatarNumerosSolicitados(venda) {
  const numeros = parseJson(venda.cliente_solicitou_numeros, {});
  return [
    `Bloqueio: ${formatarLista(numeros.bloqueio || [])}`,
    `Cancelamento: ${formatarLista(numeros.cancelamento || [])}`
  ].join('\n');
}

function formatarTiposServico(venda) {
  const labels = { novo: 'Novo', portabilidade: 'Portabilidade' };
  const tipos = Array.from(new Set(normalizarItensChips(venda.valores_unitarios_chips)
    .map(item => item.tipo_linha || item.tipo || item.categoria)
    .filter(Boolean)));
  return tipos.length ? tipos.map(tipo => labels[tipo] || tipo).join(', ') : 'Não informado';
}

function montarDescricaoChips(venda) {
  const itens = normalizarItensChips(venda.valores_unitarios_chips);
  if (!itens.length) return 'Não informado';
  const vendedoras = new Map((venda.vendedoras || []).map(item => [Number(item.id), item.nome]));
  const vendedoraPadrao = venda.vendedoras?.length === 1
    ? venda.vendedoras[0]?.nome
    : venda.vendedora?.nome;
  return itens.map((item, indice) => [
    `Chip ${indice + 1}:`,
    `  Quantidade: ${valorInformado(item.quantidade)}`,
    `  Franquia: ${item.gb ? `${item.gb} GB` : 'Não informado'}`,
    `  Tipo: ${valorInformado(item.tipo_linha || item.tipo || item.categoria)}`,
    `  Operadora atual: ${valorInformado(item.operadora_atual_nome)}`,
    `  Operadora destino: ${valorInformado(item.operadora_nome)}`,
    `  Vendedora: ${valorInformado(item.vendedora_nome || vendedoras.get(Number(item.vendedora_id)) || vendedoraPadrao)}`,
    `  Valor unitário: ${formatarMoeda(item.valor_unitario)}`
  ].join('\n')).join('\n');
}

function secao(titulo, campos) {
  return [`── ${titulo} ──`, ...campos.map(([label, valor]) => `${label}: ${valorInformado(valor)}`)].join('\n');
}

function montarMensagemVenda(venda = {}) {
  const veioDaPrimeiraLigacao = Boolean(venda.origem_lead_linha_id);
  const vendedoras = Array.isArray(venda.vendedoras) && venda.vendedoras.length
    ? venda.vendedoras.map(item => item.nome).filter(Boolean).join(', ')
    : venda.vendedora?.nome;
  const cabecalho = venda.mensagem_teste
    ? `🧪 TESTE — VENDA LOCAL #${venda.id || 'Não informado'}`
    : `✅ NOVA VENDA CADASTRADA #${venda.id || 'Não informado'}`;
  const secoes = [
    secao('ORIGEM E IDENTIFICAÇÃO', [
      ['Origem', veioDaPrimeiraLigacao ? 'Sondagem da primeira ligação' : 'Cadastro direto'],
      ['Primeira ligação realizada por', veioDaPrimeiraLigacao ? venda.origemSondador?.nome : 'Não se aplica'],
      ['Cliente selecionado', venda.cliente?.nome || venda.nome],
      ['ID do cliente', venda.cliente_id],
      ['Classificação do cliente', formatarBooleano(venda.cliente_da_base) === 'Sim' ? 'Cliente da base' : (formatarBooleano(venda.cliente_da_base) === 'Não' ? 'Cliente fora da base' : 'Não informado')],
      ['Possui documentação na casa', formatarBooleano(venda.possui_doc_na_casa)]
    ]),
    secao('DADOS DO CLIENTE', [
      ['Nome / Fantasia', venda.nome], ['Razão social', venda.razao_social], ['CNPJ/CPF', venda.cnpj],
      ['Telefone celular', formatarTelefone(venda.telefone)], ['Telefone fixo', formatarTelefone(venda.fixo_ddd)],
      ['E-mail', venda.email], ['E-mail 2', venda.email_2]
    ]),
    secao('REPRESENTANTE LEGAL (RL)', [
      ['Nome RL', venda.nome_representante_legal], ['CPF RL', venda.cpf_representante_legal],
      ['RG RL', venda.rg_representante_legal], ['Data de nascimento RL', formatarDataHora(venda.data_nascimento_representante_legal)],
      ['Telefone RL', formatarTelefone(venda.telefone_representante_legal)], ['E-mail RL', venda.email_representante_legal]
    ]),
    secao('ADMINISTRADOR (ADM)', [
      ['Nome ADM', venda.nome_administrador], ['CPF ADM', venda.cpf_administrador],
      ['RG ADM', venda.rg_administrador], ['Data de nascimento ADM', formatarDataHora(venda.data_nascimento_administrador)],
      ['Telefone ADM', formatarTelefone(venda.telefone_administrador)], ['E-mail ADM', venda.email_administrador]
    ]),
    secao('DADOS DA VENDA', [
      ['Data da venda', formatarDataHora(venda.data_venda)], ['Data da ativação', formatarDataHora(venda.data_ativacao)],
      ['Venda fechada com', venda.nome_fechou_venda], ['Setor/Função', venda.setor_funcao], ['QC feito por', venda.qc_feito_por],
      ['Status do funil', venda.status_funil], ['Prioridade', venda.prioridade_funil], ['Tipo de venda', venda.tipoVenda?.nome]
    ]),
    secao('PRODUTO E VALORES', [
      ['Operadora atual (padrão)', venda.operadoraAtual?.nome], ['Operadora destino (padrão)', venda.operadora?.nome],
      ['Produto', venda.servico?.nome], ['Tipo de produto', venda.tipoProduto?.nome], ['Produto fechado (legado)', venda.produto_fechado],
      ['Quantidade de linhas fechadas', venda.quantidade_linhas], ['DDD', venda.ddd], ['Dia de vencimento', venda.dia_vencimento],
      ['Serviço', formatarTiposServico(venda)], ['Valor total', formatarMoeda(venda.valor_total)],
      ['Números ativados', formatarLista(venda.numeros_ativados)], ['Números a serem portados', formatarLista(venda.numeros_portados)]
    ]),
    secao('CHIPS, GIGAS E VALORES UNITÁRIOS', [['Detalhamento', `\n${montarDescricaoChips(venda)}`]]),
    secao('SOLICITAÇÕES DO CLIENTE', [
      ['Cliente solicitou', formatarServicosSolicitados(venda)], ['Quantidade para bloqueio', venda.cliente_solicitou_bloqueio_qtd],
      ['Quantidade para cancelamento', venda.cliente_solicitou_cancelamento_qtd], ['Números solicitados', `\n${formatarNumerosSolicitados(venda)}`],
      ['Solicitação resolvida', venda.cliente_solicitou_resolvido], ['Resolvida em', formatarDataHora(venda.cliente_solicitou_resolvido_em)],
      ['Protocolo do atendimento', venda.cliente_solicitou_protocolo_atendimento], ['Observação da resolução', venda.cliente_solicitou_observacao]
    ]),
    secao('LOCAL DE INSTALAÇÃO/ENTREGA', [
      ['CEP', venda.cep], ['Endereço', venda.endereco], ['Número', venda.numero_endereco], ['Complemento', venda.complemento],
      ['Bairro', venda.bairro], ['Município', venda.municipio], ['UF', venda.uf],
      ['Endereço da Receita diverge do real', formatarBooleano(venda.endereco_real_divergente)],
      ['Ponto de referência', venda.ponto_referencia], ['Tipo de local', venda.tipo_local_cpf]
    ]),
    secao('ENDEREÇO REAL', [
      ['CEP real', venda.cep_real], ['Endereço real', venda.endereco_real], ['Número real', venda.numero_endereco_real],
      ['Complemento real', venda.complemento_real], ['Bairro real', venda.bairro_real],
      ['Município real', venda.municipio_real], ['UF real', venda.uf_real]
    ]),
    secao('ACEITE E ACESSO', [
      ['Horário de aceite (legado)', venda.horario_aceite_voz],
      ['Janela de dias', [venda.dia_aceite_inicio, venda.dia_aceite_fim].filter(Boolean).join(' até ')],
      ['Janela de horários', [venda.horario_aceite_inicio, venda.horario_aceite_fim].filter(Boolean).join(' até ')],
      ['Dia fixo', venda.dia_aceite_fixo], ['Horário fixo', venda.horario_aceite_fixo],
      ['Protocolo do cliente', venda.protocolo], ['Login do portal', venda.login], ['Senha do portal', venda.senha],
      ['Número do cliente no contrato', venda.numero_cliente_contrato]
    ]),
    secao('RESPONSÁVEIS PELO RECEBIMENTO', [
      ['Responsável 1', venda.responsavel_recebimento], ['RG responsável 1', venda.rg_responsavel_recebimento],
      ['Responsável 2', venda.responsavel_recebimento_2], ['RG responsável 2', venda.rg_responsavel_recebimento_2],
      ['Responsável 3', venda.responsavel_recebimento_3], ['RG responsável 3', venda.rg_responsavel_recebimento_3]
    ]),
    secao('OBSERVAÇÕES', [['Observações da venda', venda.observacoes]])
  ];
  return [
    cabecalho,
    `Cadastrada por: ${valorInformado(venda.criador?.nome)}`,
    `Consultora(s): ${valorInformado(vendedoras)}`,
    ...secoes
  ].join('\n\n');
}

function dividirTextoTelegram(texto, limite = 3900) {
  const partes = [];
  let atual = '';
  for (const linhaOriginal of String(texto || '').split('\n')) {
    const pedacos = linhaOriginal.length > limite
      ? linhaOriginal.match(new RegExp(`.{1,${limite}}`, 'g')) || ['']
      : [linhaOriginal];
    for (const linha of pedacos) {
      const proximo = atual ? `${atual}\n${linha}` : linha;
      if (proximo.length > limite && atual) {
        partes.push(atual);
        atual = linha;
      } else atual = proximo;
    }
  }
  if (atual) partes.push(atual);
  return partes;
}

function montarMensagensVenda(venda = {}) {
  const partes = dividirTextoTelegram(montarMensagemVenda(venda));
  if (partes.length <= 1) return partes;
  return partes.map((parte, indice) => indice === 0
    ? `${parte}\n\nContinua na próxima mensagem (${indice + 1}/${partes.length}).`
    : `📄 CONTINUAÇÃO DA VENDA #${venda.id || 'Não informado'} (${indice + 1}/${partes.length})\n\n${parte}`);
}

function montarMensagemFuturoCliente(linha = {}) {
  const sondagem = linha.sondagem || {};
  const telefone = [sondagem.whatsapp_ddd, sondagem.whatsapp_numero].filter(Boolean).join('');
  const itensChips = Array.isArray(sondagem.chips_itens) ? sondagem.chips_itens : [];
  const descricaoChips = itensChips.length ? itensChips.map(item => `${item.quantidade}x ${formatarMoeda(item.preco_por_chip)}`).join(', ') : `${sondagem.quantidade_chips || 0} chip(s)`;
  const tipoContato = sondagem.contato_tipo === 'adm' ? 'ADM' : (sondagem.contato_tipo === 'rl' ? 'RL' : 'Não informado');
  return [
    '📌 NOVO FUTURO CLIENTE', '', `Cadastro feito por: ${sondagem.usuario?.nome || 'Não informado'}`, '',
    `Empresa: ${sondagem.razao_social || 'Não informada'}`, `CNPJ: ${sondagem.cnpj || 'Não informado'}`,
    `Contato: ${sondagem.contato_nome || 'Não informado'} (${tipoContato})`, `Melhor número para contato: ${formatarTelefone(sondagem.melhor_numero_contato)}`,
    `WhatsApp: ${formatarTelefone(telefone)}`, `Operadora atual: ${sondagem.operadoraAtual?.nome || 'Não informada'}`,
    `Chips atuais: ${descricaoChips}`, `Valor mensal estimado: ${formatarMoeda(sondagem.valor_mensal_estimado)}`,
    `Fixo: ${formatarTelefone(sondagem.telefone_fixo)}`, `Terminal: ${formatarTelefone(sondagem.terminal)}`,
    `Data da ativacao: ${formatarDataHora(sondagem.data_ativacao)}`,
    `Operadora de interesse: ${sondagem.operadoraInteresse?.nome || 'Nao informada'}`,
    
    `Data do contato: ${formatarDataHora(sondagem.respondido_em || linha.futuro_cliente_marcado_em)}`,
    `Retorno: ${formatarDataHora(sondagem.retorno_em || linha.futuro_cliente_retorno)}`, `Observações: ${sondagem.observacoes || 'Nenhuma'}`
  ].join('\n');
}

function montarMensagemFuturoClienteRevertido(linha = {}) {
  return `❌ FUTURO CLIENTE REVERTIDO\n\nEste contato foi revertido no CRM e não está mais disponível para encaminhamento.\n\n${montarMensagemFuturoCliente(linha)}`.slice(0, 4096);
}

async function enviarFuturoCliente(linha) {
  const chatId = obterChatId('TELEGRAM_FUTUROS_CLIENTES_CHAT_ID');
  if (!tokenConfigurado() || !chatId) return { enviado: false, motivo: 'telegram_nao_configurado' };
  const resultado = await chamarApi('sendMessage', {
    chat_id: chatId,
    text: montarMensagemFuturoCliente(linha),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Encaminhar', callback_data: `fc:selecionar:${linha.id}` }]] }
  });
  return { enviado: true, message_id: resultado?.message_id || null };
}

async function atualizarMensagemFuturoClienteRevertido(publicacao, linha, opcoes = {}) {
  const chatId = String(publicacao?.telegram_chat_id || '').trim();
  const messageId = String(publicacao?.telegram_message_id || '').trim();
  if (!chatId || !messageId) return { atualizado: false, motivo: 'mensagem_telegram_nao_encontrada' };

  const chamar = opcoes.chamarApi || chamarApi;
  await chamar('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: montarMensagemFuturoClienteRevertido(linha),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }
  });
  return { atualizado: true };
}

async function enviarResumoVendas(texto) {
  const chatId = obterChatId('TELEGRAM_RESUMO_VENDAS_CHAT_ID');
  if (!tokenConfigurado() || !chatId) return { enviado: false, motivo: 'telegram_nao_configurado' };
  const resultado = await chamarApi('sendMessage', { chat_id: chatId, text: String(texto || ''), disable_web_page_preview: true });
  return { enviado: true, message_id: resultado?.message_id || null };
}

async function enviarVenda(venda) {
  const chatId = obterChatId('TELEGRAM_VENDAS_CHAT_ID');
  if (!tokenConfigurado() || !chatId) return { enviado: false, motivo: 'telegram_nao_configurado' };
  const resultados = [];
  for (const texto of montarMensagensVenda(venda)) {
    resultados.push(await chamarApi('sendMessage', {
      chat_id: chatId,
      text: texto,
      disable_web_page_preview: true
    }));
  }
  return {
    enviado: true,
    message_id: resultados.at(-1)?.message_id || null,
    message_ids: resultados.map(resultado => resultado?.message_id).filter(Boolean)
  };
}

module.exports = {
  enviarFuturoCliente,
  atualizarMensagemFuturoClienteRevertido,
  enviarResumoVendas,
  enviarVenda,
  chamarApi,
  chamarApiComToken,
  _internals: {
    formatarDataHora,
    formatarMoeda,
    formatarTelefone,
    montarMensagemFuturoCliente,
    montarMensagemFuturoClienteRevertido,
    montarMensagemVenda,
    montarMensagensVenda,
    dividirTextoTelegram,
    obterChatId
  }
};

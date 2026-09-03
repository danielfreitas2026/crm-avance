function textoCanonico(valor) {
  return String(valor || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[�]/g, '?')
    .toLowerCase()
    .replace(/[^a-z0-9?.,:/><\-\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function rotuloFlexivel(rotulo) {
  return textoCanonico(rotulo)
    .replace(/[.*+^${}()|[\]\\]/g, '\\$&')
    .replace(/[aeiou]/g, '[aeiou?]{1,3}')
    .replace(/ /g, '\\s+');
}

function extrairLinha(texto, rotulo, proximos = []) {
  const fim = proximos.length ? `(?=\\n\\s*(?:${proximos.map(rotuloFlexivel).join('|')})\\s*:|$)` : '(?=\\n|$)';
  const regex = new RegExp(`${rotuloFlexivel(rotulo)}\\s*:\\s*([\\s\\S]*?)${fim}`, 'i');
  return String(texto || '').match(regex)?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

function numeroDocumento(valor) {
  const grupos = String(valor || '').match(/\d[\d.\/-]{9,20}/g) || [];
  return grupos.map(item => item.replace(/\D/g, '')).find(item => item.length === 11 || item.length === 14) || null;
}

function parseData(valor) {
  const match = String(valor || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function parseDinheiro(valor) {
  const match = String(valor || '').match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : null;
}

function extrairResumo(texto) {
  const bloco = String(texto || '').split(/workflow\s*\(/i)[0].split(/resumo da venda/i).at(-1) || '';
  const linhaTotal = bloco.match(/\btotal\s+(\d+)\s+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (linhaTotal) return { quantidade: Number(linhaTotal[1]), valor_mensal: parseDinheiro(linhaTotal[2]) };
  const linhas = bloco.split(/\r?\n/).map(linha => linha.trim()).filter(Boolean);
  const total = linhas.findLast?.(linha => /^total\b/i.test(textoCanonico(linha))) || linhas.at(-1) || '';
  const numeros = total.match(/\d+(?:[.,]\d+)?/g) || [];
  const monetarios = bloco.match(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/gi) || [];
  return {
    quantidade: numeros.length ? Number(numeros[0].replace(',', '.')) : null,
    valor_mensal: monetarios.length ? parseDinheiro(monetarios.at(-2) || monetarios.at(-1)) : null
  };
}

function classificarDestino(destino) {
  const valor = textoCanonico(destino);
  if (/pedido\s+cancelado\s+pelo\s+(?:consultor|cliente)/.test(valor)) return { classificacao: 'cancelamento', alvo: 'cancelar_venda' };
  if (/vivocorp\s*-\s*pedidos\s*>\s*cancelado\s+manualmente/.test(valor)) return { classificacao: 'cancelamento', alvo: 'cancelar_venda' };
  if (/antifraude.*processo.*revis[a-z?]{0,6}o\s+cr[ai?]{1,4}tica/.test(valor)) return { classificacao: 'sem_acao', alvo: 'sem_acao' };
  if (/an[ai?]{1,4}lise\s+(?:da\s+)?ilha\s+de\s+auditoria/.test(valor)) return { classificacao: 'sem_acao', alvo: 'sem_acao' };
  if (/an[ai?]{1,4}lise\s+da\s+ilha\s+de\s+input/.test(valor)) return { classificacao: 'sem_acao', alvo: 'sem_acao' };
  if (/aguardando\s+tratativas\s+da\s+auditoria/.test(valor)) return { classificacao: 'sem_acao', alvo: 'sem_acao' };
  if (/an(?:[ai?]{1,4}|\s+)lise\s+da\s+qualidade\s+e\s+auditoria/.test(valor)) return { classificacao: 'tipo_1', alvo: 'apos_aceite_biometria' };
  if (/vivocorp\s*-\s*pedidos\s*>\s*backoffice\s+aprovado/.test(valor)) return { classificacao: 'tipo_1', alvo: 'apos_aceite_biometria' };
  if (/aguardando\s+aceite\s*[/ ]\s*assinatura/.test(valor)) return { classificacao: 'tipo_1', alvo: 'aceite_biometria' };
  if (/pend(?:[e?]{1,3}|\s+)ncia\s+pr(?:[e?]{1,3}|\s+)\s*-?\s*venda/.test(valor)) return { classificacao: 'tipo_1', alvo: 'aceite_biometria' };
  if (/suporte\s+pr(?:[e?]{1,3}|\s+)\s*-?\s*venda/.test(valor)) return { classificacao: 'tipo_1', alvo: 'aceite_biometria' };
  if (/aguardando\s+input\s+autom[a?]{1,4}tico/.test(valor)) return { classificacao: 'tipo_1', alvo: 'apos_aceite_biometria' };
  if (/\binput\s+realizado\s+com\s+sucesso\b/.test(valor)) return { classificacao: 'tipo_1', alvo: 'apos_aceite_biometria' };
  if (/log[ai?]{1,4}stica\s+conclu[ai?]{1,4}da/.test(valor)) return { classificacao: 'tipo_1', alvo: 'etapa_final' };
  if (/corre[a-z?]{0,5}o\s+do\s+pedido\s+de\s+venda\s+pelo\s+consultor/.test(valor)) return { classificacao: 'tipo_2', alvo: null };
  return { classificacao: 'desconhecido', alvo: null };
}

function interpretarEmail(texto) {
  const corpo = String(texto || '').replace(/\r/g, '');
  const destino = extrairLinha(corpo, 'Destino', ['Vivocorp', 'Cotação', 'Pedido']);
  const origem = extrairLinha(corpo, 'Origem', ['Mensagem ao Operador', 'Destino']);
  const mensagem = extrairLinha(corpo, 'Mensagem ao Operador', ['Destino']);
  const resumo = extrairResumo(corpo);
  const resultado = classificarDestino(destino);
  return {
    documento: numeroDocumento(extrairLinha(corpo, 'CNPJ', ['Razão Social', 'Nome Comercial'])),
    data_venda: parseData(extrairLinha(corpo, 'Data da Venda', ['CNPJ'])),
    quantidade: resumo.quantidade,
    valor_mensal: resumo.valor_mensal,
    origem,
    destino,
    mensagem_operador: mensagem,
    ...resultado
  };
}

module.exports = { textoCanonico, interpretarEmail, classificarDestino, _internals: { numeroDocumento, parseData, parseDinheiro, extrairLinha, extrairResumo } };

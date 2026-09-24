const { textoCanonico } = require('./vivo-email-parser.service');

function decodificarEntidades(valor) {
  return String(valor || '')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));?/gi, (entidade, hexadecimal, decimal) => {
      const codigo = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entidade;
    })
    .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (entidade, nome) => ({
      nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'
    })[nome.toLowerCase()] || entidade);
}

function limparEmpresa(valor) {
  return decodificarEntidades(valor).replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim() || null;
}

function normalizarNome(valor) {
  return textoCanonico(decodificarEntidades(valor)).replace(/[^a-z0-9]+/g, ' ').trim();
}

function interpretarEmailClaro(assunto, corpo) {
  const assuntoCanonico = textoCanonico(assunto).replace(/\s+/g, ' ').trim();
  if (!/^(?:status de pedido|atualizacao de pedido)(?:\s*-\s*.+)?$/.test(assuntoCanonico)) {
    return { estrutura_valida: false, empresa: null, classificacao: 'desconhecido', alvo: null };
  }

  const original = decodificarEntidades(corpo).replace(/\s+/g, ' ').trim();
  const regras = [
    { regex: /\bo aceite do cliente\s+(.+?)\s+(?:[eé]|foi)\s+enviado\b/i, acao: 'aceite_enviado', alvo: 'aceite_biometria', aceite: false, biometria: false },
    { regex: /\bo cliente\s+(.+?)\s+assinou o contrato\b/i, acao: 'contrato_assinado', alvo: 'aceite_biometria', aceite: true, biometria: false },
    { regex: /\bo pedido do cliente\s+(.+?)\s+foi aprovado cr[eé]dito\b/i, acao: 'credito_aprovado', alvo: 'apos_aceite_biometria', aceite: true, biometria: true },
    { regex: /\bo pedido do cliente\s+(.+?)\s+foi faturado\b/i, acao: 'pedido_faturado', alvo: 'etapa_final', aceite: true, biometria: true },
    { regex: /\bo pedido do cliente\s+(.+?)\s+est[aá] em an[aá]lise claro\b/i, acao: 'analise_claro', alvo: 'sem_acao', aceite: false, biometria: false }
  ];
  const encontrada = regras.map(regra => ({ regra, correspondencia: original.match(regra.regex) })).find(item => item.correspondencia);
  if (!encontrada) return { estrutura_valida: false, empresa: null, classificacao: 'desconhecido', alvo: null };
  const { regra, correspondencia } = encontrada;
  const empresa = limparEmpresa(correspondencia[1]);
  return {
    estrutura_valida: Boolean(empresa),
    empresa,
    empresa_normalizada: normalizarNome(empresa),
    classificacao: regra.alvo === 'sem_acao' ? 'sem_acao' : 'tipo_1',
    alvo: regra.alvo,
    acao: regra.acao,
    marcar_aceite: regra.aceite,
    marcar_biometria: regra.biometria,
    destino: regra.acao
  };
}

function dominio(email) {
  return String(email || '').toLowerCase().split('@')[1] || '';
}

function alinhado(dominioAssinado, dominioRemetente) {
  const assinado = String(dominioAssinado || '').toLowerCase().replace(/[;\s].*$/, '');
  return Boolean(assinado && dominioRemetente && (assinado === dominioRemetente || dominioRemetente.endsWith(`.${assinado}`) || assinado.endsWith(`.${dominioRemetente}`)));
}

function autenticarRemetente(headers, remetente) {
  const valores = headers?.get?.('authentication-results') || headers?.get?.('arc-authentication-results') || '';
  const texto = Array.isArray(valores) ? valores.join(' ') : String(valores || '');
  const dominioFrom = dominio(remetente);
  const dkim = texto.match(/\bdkim=pass\b[\s\S]*?\bheader\.d=([^\s;]+)/i);
  const dmarc = texto.match(/\bdmarc=pass\b[\s\S]*?\bheader\.from=([^\s;]+)/i);
  return Boolean(dkim && dmarc && alinhado(dkim[1], dominioFrom) && alinhado(dmarc[1], dominioFrom));
}

module.exports = { interpretarEmailClaro, normalizarNome, autenticarRemetente, _internals: { alinhado, dominio, limparEmpresa } };

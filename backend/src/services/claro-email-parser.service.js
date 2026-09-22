const { textoCanonico } = require('./vivo-email-parser.service');

function limparEmpresa(valor) {
  return String(valor || '').replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim() || null;
}

function normalizarNome(valor) {
  return textoCanonico(valor).replace(/[^a-z0-9]+/g, ' ').trim();
}

function interpretarEmailClaro(assunto, corpo) {
  const assuntoCanonico = textoCanonico(assunto).replace(/\s+/g, ' ').trim();
  if (!/^status de pedido(?:\s*-\s*.+)?$/.test(assuntoCanonico)) {
    return { estrutura_valida: false, empresa: null, classificacao: 'desconhecido', alvo: null };
  }

  const original = String(corpo || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  const canonico = textoCanonico(original);
  const regras = [
    { regex: /^o aceite do cliente (.+?) e enviado\b/, acao: 'aceite_enviado', alvo: 'aceite_biometria', aceite: false, biometria: false },
    { regex: /^o cliente (.+?) assinou o contrato\b/, acao: 'contrato_assinado', alvo: 'aceite_biometria', aceite: true, biometria: false },
    { regex: /^o pedido do cliente (.+?) foi aprovado credito\b/, acao: 'credito_aprovado', alvo: 'apos_aceite_biometria', aceite: true, biometria: true },
    { regex: /^o pedido do cliente (.+?) foi faturado\b/, acao: 'pedido_faturado', alvo: 'etapa_final', aceite: true, biometria: true },
    { regex: /^o pedido do cliente (.+?) esta em analise claro\b/, acao: 'analise_claro', alvo: 'sem_acao', aceite: false, biometria: false }
  ];
  const regra = regras.find(item => item.regex.test(canonico));
  if (!regra) return { estrutura_valida: false, empresa: null, classificacao: 'desconhecido', alvo: null };
  const empresaCanonica = canonico.match(regra.regex)?.[1] || '';
  const inicio = canonico.indexOf(empresaCanonica);
  const empresa = limparEmpresa(inicio >= 0 ? original.slice(inicio, inicio + empresaCanonica.length) : empresaCanonica);
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

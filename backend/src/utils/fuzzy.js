/**
 * Motor de correspondencia aproximada (fuzzy matching).
 *
 * Modulo puro, sem dependencia de banco ou rede: recebe textos e devolve um
 * grau de similaridade de 0 a 1. Usado para medir o quanto o resultado de uma
 * fonte externa (ex.: Google Places) corresponde de fato a empresa do mailing,
 * permitindo pontuar a confiabilidade em vez de exigir igualdade exata.
 *
 * As funcoes principais:
 *  - normalizar(texto)                -> padroniza acento/caixa/pontuacao
 *  - levenshtein(a, b)                -> numero de edicoes entre duas strings
 *  - levenshteinRatio(a, b)           -> similaridade 0-1 baseada em edicoes
 *  - jaroWinkler(a, b)                -> similaridade 0-1 (bom para nomes)
 *  - similaridadeNome(a, b)           -> similaridade 0-1 de nomes de empresa
 *  - confiancaEmpresa(nome, dados, candidato) -> confianca 0-1 do match
 */

// Termos genericos que nao ajudam a distinguir uma empresa da outra. Sao
// removidos antes de comparar nomes para evitar que "LTDA", "ME", "COMERCIO"
// etc. inflem artificialmente a similaridade.
const STOPWORDS_EMPRESA = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 'cia', 'mei',
  'comercio', 'comercial', 'industria', 'servicos', 'servico',
  'e', 'de', 'da', 'do', 'das', 'dos', 'the'
]);

/**
 * Padroniza um texto para comparacao: remove acentos, troca pontuacao por
 * espaco, colapsa espacos e passa para minusculas.
 */
function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Quebra um texto ja normalizado em tokens relevantes (>= 2 caracteres e fora
 * da lista de termos genericos).
 */
function tokensSignificativos(textoNormalizado) {
  return String(textoNormalizado || '')
    .split(' ')
    .filter(token => token.length >= 2 && !STOPWORDS_EMPRESA.has(token));
}

/**
 * Distancia de Levenshtein: numero minimo de insercoes, remocoes ou
 * substituicoes para transformar `a` em `b`.
 */
function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let linhaAnterior = Array.from({ length: t.length + 1 }, (_, i) => i);
  let linhaAtual = new Array(t.length + 1);

  for (let i = 0; i < s.length; i += 1) {
    linhaAtual[0] = i + 1;
    for (let j = 0; j < t.length; j += 1) {
      const custo = s[i] === t[j] ? 0 : 1;
      linhaAtual[j + 1] = Math.min(
        linhaAtual[j] + 1,          // insercao
        linhaAnterior[j + 1] + 1,   // remocao
        linhaAnterior[j] + custo    // substituicao
      );
    }
    [linhaAnterior, linhaAtual] = [linhaAtual, linhaAnterior];
  }

  return linhaAnterior[t.length];
}

/**
 * Similaridade 0-1 derivada da distancia de Levenshtein. 1 = identicas.
 */
function levenshteinRatio(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const maior = Math.max(s.length, t.length);
  if (maior === 0) return 1;
  return 1 - levenshtein(s, t) / maior;
}

/**
 * Similaridade de Jaro (0-1) entre duas strings.
 */
function jaro(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return s.length ? 1 : 1;
  if (!s.length || !t.length) return 0;

  const janela = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const marcadosS = new Array(s.length).fill(false);
  const marcadosT = new Array(t.length).fill(false);

  let correspondencias = 0;
  for (let i = 0; i < s.length; i += 1) {
    const inicio = Math.max(0, i - janela);
    const fim = Math.min(i + janela + 1, t.length);
    for (let j = inicio; j < fim; j += 1) {
      if (marcadosT[j] || s[i] !== t[j]) continue;
      marcadosS[i] = true;
      marcadosT[j] = true;
      correspondencias += 1;
      break;
    }
  }

  if (correspondencias === 0) return 0;

  let transposicoes = 0;
  let k = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (!marcadosS[i]) continue;
    while (!marcadosT[k]) k += 1;
    if (s[i] !== t[k]) transposicoes += 1;
    k += 1;
  }
  transposicoes /= 2;

  return (
    correspondencias / s.length
    + correspondencias / t.length
    + (correspondencias - transposicoes) / correspondencias
  ) / 3;
}

/**
 * Similaridade de Jaro-Winkler (0-1): reforca o Jaro quando as strings
 * compartilham um prefixo comum. Otimo para nomes proprios/empresas.
 */
function jaroWinkler(a, b, fatorPrefixo = 0.1) {
  const s = normalizar(a);
  const t = normalizar(b);
  const base = jaro(s, t);
  if (base === 0) return 0;

  let prefixo = 0;
  const limite = Math.min(4, s.length, t.length);
  while (prefixo < limite && s[prefixo] === t[prefixo]) prefixo += 1;

  return base + prefixo * fatorPrefixo * (1 - base);
}

/**
 * Fracao dos tokens do conjunto de referencia (o menor) que encontram um
 * correspondente forte no outro conjunto. Cada token so conta quando a
 * similaridade com o melhor par atinge `limiar`, evitando que pares fracos
 * (letras em comum por acaso) inflem o resultado. Recompensa o caso em que um
 * nome esta "contido" no outro (ex.: "padaria sao joao" dentro de
 * "padaria sao joao comercio de paes"), e zera para nomes sem tokens em comum.
 */
function scoreTokens(tokensA, tokensB, limiar = 0.85) {
  if (!tokensA.length || !tokensB.length) return 0;
  const [referencia, outros] = tokensA.length <= tokensB.length
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  const soma = referencia.reduce((total, token) => {
    const melhor = outros.reduce((max, candidato) => Math.max(max, jaroWinkler(token, candidato)), 0);
    return total + (melhor >= limiar ? melhor : 0);
  }, 0);

  return soma / referencia.length;
}

/**
 * Similaridade 0-1 entre dois nomes de empresa. Combina a comparacao da string
 * inteira (Jaro-Winkler) com a comparacao token a token, ficando com a maior —
 * assim tolera tanto erro de digitacao quanto palavras a mais/a menos.
 */
function similaridadeNome(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const inteiro = jaroWinkler(na, nb);
  const porToken = scoreTokens(tokensSignificativos(na), tokensSignificativos(nb));
  return Math.max(inteiro, porToken);
}

/**
 * Confianca 0-1 de que `candidato` corresponde a empresa buscada.
 *
 * @param {string} nome         Nome/razao social buscado.
 * @param {object} dados        Dados de referencia (municipio, uf) quando houver.
 * @param {object} candidato    Resultado externo com { nome, endereco }.
 * @returns {number}            Confianca de 0 a 1.
 *
 * O peso se adapta aos sinais disponiveis: quando so ha o nome, a confianca e
 * a propria similaridade do nome; quando ha municipio/uf, eles entram como
 * confirmacao adicional.
 */
function confiancaEmpresa(nome, dados = {}, candidato = {}) {
  const nomeSim = similaridadeNome(nome, candidato.nome);
  const endereco = normalizar(candidato.endereco);

  const sinais = [{ valor: nomeSim, peso: 0.6 }];
  if (dados.municipio) {
    sinais.push({ valor: endereco.includes(normalizar(dados.municipio)) ? 1 : 0, peso: 0.25 });
  }
  if (dados.uf) {
    sinais.push({ valor: endereco.includes(normalizar(dados.uf)) ? 1 : 0, peso: 0.15 });
  }

  const somaPesos = sinais.reduce((total, sinal) => total + sinal.peso, 0);
  if (somaPesos === 0) return 0;
  const media = sinais.reduce((total, sinal) => total + sinal.valor * sinal.peso, 0) / somaPesos;
  return Math.round(media * 1000) / 1000;
}

module.exports = {
  normalizar,
  tokensSignificativos,
  levenshtein,
  levenshteinRatio,
  jaro,
  jaroWinkler,
  scoreTokens,
  similaridadeNome,
  confiancaEmpresa
};

/**
 * Formatos numericos das planilhas exportadas, fixados na regra brasileira.
 *
 * O separador decimal exibido em um .xlsx e decidido pelo idioma de quem abre o
 * arquivo: o codigo de formato e um template neutro, nao um separador literal.
 * O prefixo de locale [$-416] (portugues do Brasil) instrui o Excel a renderizar
 * com virgula decimal e ponto de milhar mesmo em maquina configurada em ingles,
 * mantendo a celula como numero de verdade (soma, ordenacao e filtro seguem
 * funcionando).
 *
 * Datas continuam em dd/mm/yyyy sem prefixo: o formato ja e explicito e renderiza
 * igual em qualquer idioma.
 */

const FORMATO_MOEDA_BR = '[$R$-416] #,##0.00';
const FORMATO_DECIMAL_BR = '[$-416]#,##0.00';
const FORMATO_INTEIRO_BR = '[$-416]#,##0';
const FORMATO_PERCENTUAL_BR = '[$-416]0.0%';
const FORMATO_DATA_BR = 'dd/mm/yyyy';

/**
 * Converte para numero real de planilha, evitando celula de texto com ponto decimal.
 *
 * Valores decimais vindos do banco chegam como string ("49.90") em varios caminhos.
 * O ExcelJS grava string como celula de texto, e numFmt nao tem efeito sobre texto,
 * entao o ponto sobreviveria a qualquer formatacao.
 */
function numeroPlanilha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Retorna a classificacao da venda em relacao a base para exibicao em planilhas. */
function classificacaoClienteBasePlanilha(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return valor === true || Number(valor) === 1 ? 'Cliente base' : 'Cliente fora da base';
}

module.exports = {
  FORMATO_MOEDA_BR,
  FORMATO_DECIMAL_BR,
  FORMATO_INTEIRO_BR,
  FORMATO_PERCENTUAL_BR,
  FORMATO_DATA_BR,
  classificacaoClienteBasePlanilha,
  numeroPlanilha
};

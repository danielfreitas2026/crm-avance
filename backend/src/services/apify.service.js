/**
 * PROVEDOR DE CONTATO: APIFY  (PLACEHOLDER — ainda NAO faz chamadas externas)
 * ============================================================================
 *
 * Este arquivo e o "encaixe" (seam) preparado para uma futura integracao com a
 * Apify como FONTE COMPLEMENTAR de contatos, usada apenas quando o Google Places
 * nao devolve um telefone confiavel (ver lead-enriquecimento.service.js).
 *
 * Hoje ele e um stub: retorna sempre { encontrado: false, motivo: '...' } e nao
 * gasta nada. Quando for implementar, basta preencher `buscarContatoEmpresa`
 * seguindo o CONTRATO abaixo — o restante do pipeline ja esta pronto para
 * consumir esse retorno.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO DE RETORNO (o mesmo "idioma" do google-places, para encaixar direto)
 * ---------------------------------------------------------------------------
 *   {
 *     encontrado: boolean,
 *     fonte: 'apify',
 *     motivo?: 'sem_token' | 'nao_implementado' | 'sem_match' | 'limite' | 'erro',
 *     query?: string,
 *     // quando encontrado === true:
 *     telefone?: string,      // apenas digitos (reutilize fuzzy/normalizarTelefone)
 *     contato?: {
 *       telefone?: string,
 *       site?: string,
 *       instagram?: string,
 *       facebook?: string,
 *       nome?: string,
 *       endereco?: string
 *     },
 *     confianca?: number,     // 0-1, calculada com fuzzy.confiancaEmpresa()
 *     confianca_pct?: number, // Math.round(confianca * 100)
 *     confianca_nivel?: 'alta' | 'media' | 'baixa'
 *   }
 *
 * ---------------------------------------------------------------------------
 * PASSOS PARA CONCLUIR A INTEGRACAO (quando decidir usar Apify)
 * ---------------------------------------------------------------------------
 *  1. Criar conta na Apify e escolher um Actor. Para o objetivo "telefone mais
 *     assertivo", prefira um "contact scraper" (extrai telefone/e-mail do SITE
 *     da empresa) em vez de scraper de rede social — melhor taxa de acerto de
 *     telefone e menos risco (LGPD / termos das plataformas).
 *  2. Definir as envs:
 *       APIFY_TOKEN            = token da conta Apify
 *       APIFY_ATOR_CONTATO     = id/slug do Actor escolhido
 *     (opcional) APIFY_TETO_MENSAL_CHAMADAS para teto de custo, espelhando o
 *     que o google-places ja faz.
 *  3. Implementar `buscarContatoEmpresa`: chamar o Actor via API de "run-sync"
 *     (https://api.apify.com/v2/acts/<ATOR>/run-sync-get-dataset-items?token=...),
 *     passando o site/nome da empresa como input.
 *  4. Medir a confianca do retorno com o MESMO motor fuzzy usado no Google:
 *       const confianca = fuzzy.confiancaEmpresa(nomeBusca, dados, { nome, endereco });
 *     Assim a % exibida no card sai coerente entre as duas fontes.
 *  5. Nenhuma migration nova e necessaria: o worker ja reprocessa as linhas com
 *     status 'sem_resultado' e recomenda_apify = 1 (ver seam no
 *     lead-enriquecimento.service.js). Ao concluir, grave fonte = 'apify'.
 */

// const axios = require('axios');
// const fuzzy = require('../utils/fuzzy');

const APIFY_TOKEN = String(process.env.APIFY_TOKEN || '').trim();
const APIFY_ATOR_CONTATO = String(process.env.APIFY_ATOR_CONTATO || '').trim();

/**
 * Indica se a Apify esta configurada (token + Actor). Enquanto for stub,
 * mesmo configurada ela retorna 'nao_implementado'.
 */
function apifyConfigurada() {
  return Boolean(APIFY_TOKEN && APIFY_ATOR_CONTATO);
}

/**
 * Busca contato complementar de uma empresa. STUB: nao chama a Apify ainda.
 *
 * @param {object} dados  { razaoSocial, nomeFantasia, municipio, uf, site? }
 * @returns {Promise<object>} resultado seguindo o CONTRATO documentado no topo.
 */
async function buscarContatoEmpresa(dados = {}) {
  if (!apifyConfigurada()) {
    return { encontrado: false, fonte: 'apify', motivo: 'sem_token' };
  }

  // ---------------------------------------------------------------------------
  // TODO(apify): implementar a chamada real ao Actor. Esqueleto de referencia:
  //
  // const nomeBusca = dados.nomeFantasia || dados.razaoSocial || '';
  // const resposta = await axios.post(
  //   `https://api.apify.com/v2/acts/${APIFY_ATOR_CONTATO}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  //   { /* input do Actor: site/nome da empresa */ },
  //   { timeout: 60000 }
  // );
  // const item = Array.isArray(resposta.data) ? resposta.data[0] : null;
  // if (!item) return { encontrado: false, fonte: 'apify', motivo: 'sem_match' };
  // const confianca = fuzzy.confiancaEmpresa(nomeBusca, dados, { nome: item.nome, endereco: item.endereco });
  // return {
  //   encontrado: Boolean(item.telefone),
  //   fonte: 'apify',
  //   telefone: item.telefone || '',
  //   contato: { telefone: item.telefone, site: item.site, instagram: item.instagram, facebook: item.facebook, nome: item.nome, endereco: item.endereco },
  //   confianca,
  //   confianca_pct: Math.round(confianca * 100),
  //   confianca_nivel: confianca >= 0.85 ? 'alta' : confianca >= 0.72 ? 'media' : 'baixa'
  // };
  // ---------------------------------------------------------------------------

  return { encontrado: false, fonte: 'apify', motivo: 'nao_implementado' };
}

module.exports = {
  // Flag consumida pelo pipeline: enquanto false, o seam de Apify fica inerte.
  APIFY_DISPONIVEL: false,
  apifyConfigurada,
  buscarContatoEmpresa
};

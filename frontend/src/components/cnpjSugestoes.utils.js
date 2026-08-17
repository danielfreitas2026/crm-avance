import { formatDateValue } from '../utils/datetime';

function formatarData(valor) {
  return formatDateValue(valor, undefined, 'sem data da fonte');
}

export function formatarMensagemResumoCnpj(dados) {
  if (!dados) return '';

  const totalFontes = dados.fontesComSucesso?.length || (dados.fonte ? 1 : 0);
  const origem = totalFontes > 1 ? `${totalFontes} fontes` : (dados.fontesComSucesso?.[0] || dados.fonte || 'fonte publica');
  const datas = Object.values(dados.fontesPorCampo || {})
    .map(meta => meta?.atualizadoEm)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a));
  const dataMaisRecente = datas[0] ? ` Atualizado na fonte em ${formatarData(datas[0])}.` : ' Sem data de atualização informada.';
  const alertas = dados.alertas?.length ? ` ${dados.alertas.length} alerta(s) para conferencia.` : '';
  const cache = dados.cache ? ' Resposta do cache.' : '';

  return `Sugestoes encontradas em ${origem}.${dataMaisRecente}${alertas}${cache}`;
}

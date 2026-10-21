// Códigos Nacionais (CN), Anatel: https://www.gov.br/anatel/pt-br/regulado/numeracao
// Os nomes são referências de área, não uma identificação do município do contato.
// O CN 61 atende o DF e municípios do entorno em GO.
const AREAS_DDD = {
  11: ['São Paulo', 'SP'], 12: ['Vale do Paraíba e litoral norte', 'SP'],
  13: ['Baixada Santista e Vale do Ribeira', 'SP'], 14: ['Bauru e Marília', 'SP'],
  15: ['Sorocaba e Itapetininga', 'SP'], 16: ['Ribeirão Preto e Araraquara', 'SP'],
  17: ['São José do Rio Preto', 'SP'], 18: ['Presidente Prudente e Araçatuba', 'SP'],
  19: ['Campinas', 'SP'], 21: ['Rio de Janeiro', 'RJ'],
  22: ['Campos dos Goytacazes e Região dos Lagos', 'RJ'], 24: ['Volta Redonda e região serrana', 'RJ'],
  27: ['Vitória e norte do estado', 'ES'], 28: ['Cachoeiro de Itapemirim e sul do estado', 'ES'],
  31: ['Belo Horizonte', 'MG'], 32: ['Juiz de Fora e Zona da Mata', 'MG'],
  33: ['Governador Valadares e Teófilo Otoni', 'MG'], 34: ['Triângulo Mineiro e Alto Paranaíba', 'MG'],
  35: ['Sul de Minas', 'MG'], 37: ['Divinópolis e centro-oeste mineiro', 'MG'],
  38: ['Montes Claros e norte de Minas', 'MG'], 41: ['Curitiba e litoral', 'PR'],
  42: ['Ponta Grossa e Guarapuava', 'PR'], 43: ['Londrina e norte pioneiro', 'PR'],
  44: ['Maringá e noroeste', 'PR'], 45: ['Cascavel e Foz do Iguaçu', 'PR'],
  46: ['Francisco Beltrão e Pato Branco', 'PR'], 47: ['Joinville e Vale do Itajaí', 'SC'],
  48: ['Florianópolis e sul do estado', 'SC'], 49: ['Oeste e serra catarinense', 'SC'],
  51: ['Porto Alegre e região central', 'RS'], 53: ['Pelotas e Rio Grande', 'RS'],
  54: ['Caxias do Sul e Passo Fundo', 'RS'], 55: ['Santa Maria e noroeste', 'RS'],
  61: ['Brasília e entorno', 'DF/GO'], 62: ['Goiânia e norte goiano', 'GO'],
  63: ['Tocantins', 'TO'], 64: ['Sul e sudoeste goiano', 'GO'],
  65: ['Cuiabá e sudoeste', 'MT'], 66: ['Norte e leste de Mato Grosso', 'MT'],
  67: ['Mato Grosso do Sul', 'MS'], 68: ['Acre', 'AC'], 69: ['Rondônia', 'RO'],
  71: ['Salvador', 'BA'], 73: ['Ilhéus e sul da Bahia', 'BA'],
  74: ['Juazeiro e norte da Bahia', 'BA'], 75: ['Feira de Santana', 'BA'],
  77: ['Barreiras e sudoeste baiano', 'BA'], 79: ['Sergipe', 'SE'],
  81: ['Recife e leste de Pernambuco', 'PE'], 82: ['Alagoas', 'AL'],
  83: ['Paraíba', 'PB'], 84: ['Rio Grande do Norte', 'RN'],
  85: ['Fortaleza', 'CE'], 86: ['Teresina e norte do Piauí', 'PI'],
  87: ['Interior de Pernambuco', 'PE'], 88: ['Interior do Ceará', 'CE'],
  89: ['Sul do Piauí', 'PI'], 91: ['Belém e nordeste paraense', 'PA'],
  92: ['Manaus e entorno', 'AM'], 93: ['Santarém e oeste paraense', 'PA'],
  94: ['Marabá e sudeste paraense', 'PA'], 95: ['Roraima', 'RR'],
  96: ['Amapá', 'AP'], 97: ['Interior do Amazonas', 'AM'],
  98: ['São Luís e norte maranhense', 'MA'], 99: ['Interior do Maranhão', 'MA']
};
const LOCAIS_DDD = Object.entries(AREAS_DDD).map(([ddd, [area, uf]]) => ({
  ddd, area, uf, label: `${area} e região/${uf} — DDD ${ddd}`
}));
const DDDS_VALIDOS = new Set(Object.keys(AREAS_DDD).map(Number));

function extrairDddTelefone(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto || /[^\d\s()+.\-]/.test(texto)) return null;
  let numero = texto.replace(/\D/g, '');
  if (texto.startsWith('+')) {
    if (!numero.startsWith('55')) return null;
    numero = numero.slice(2);
  } else if ((numero.length === 12 || numero.length === 13) && numero.startsWith('55')) {
    numero = numero.slice(2);
  } else if (numero.startsWith('0')) {
    // 0 + DDD + telefone, ou 0 + prestadora (2 dígitos) + DDD + telefone.
    if (numero.length === 11 || numero.length === 12) numero = numero.slice(1);
    else if ((numero.length === 13 || numero.length === 14) && numero[1] !== '0') numero = numero.slice(3);
    else return null;
  }
  if (!/^\d{10,11}$/.test(numero)) return null;
  const ddd = numero.slice(0, 2);
  const assinante = numero.slice(2);
  if (!DDDS_VALIDOS.has(Number(ddd))) return null;
  if (!(assinante.length === 8 ? /^[2-5]/.test(assinante) : /^9/.test(assinante))) return null;
  return ddd;
}

function localizarTelefones(dados, campos) {
  const encontrados = new Set();
  for (const campo of campos) {
    const valor = dados[`${campo} (atualizado)`] ?? dados[campo];
    for (const telefone of String(valor ?? '').split(/[;\n\r]+/)) {
      const ddd = extrairDddTelefone(telefone);
      if (ddd) encontrados.add(ddd);
    }
  }
  const ddds = [...encontrados].sort();
  return {
    ddds,
    local: ddds.length ? ddds.map(ddd => LOCAIS_DDD.find(item => item.ddd === ddd).label).join('; ') : 'Não identificado'
  };
}

function normalizarDdd(valor) {
  const ddd = String(valor ?? '').trim();
  if (ddd && (!/^\d{2}$/.test(ddd) || !DDDS_VALIDOS.has(Number(ddd)))) {
    const error = new Error('Informe um DDD brasileiro válido.');
    error.statusCode = 400;
    throw error;
  }
  return ddd;
}

module.exports = { normalizarDdd, extrairDddTelefone, localizarTelefones, LOCAIS_DDD };

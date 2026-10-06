const TIME_ZONE = 'America/Sao_Paulo';

function dataHojeSaoPaulo(base = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(base).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function instanteSaoPaulo(data, hora) {
  const alvo = Date.parse(`${String(data).slice(0, 10)}T${hora}:00Z`);
  let instante = alvo;
  for (let i = 0; i < 3; i += 1) {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(instante)).reduce((acc, parte) => ({ ...acc, [parte.type]: parte.value }), {});
    const local = Date.parse(`${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}Z`);
    instante += alvo - local;
  }
  return new Date(instante);
}

function sqlUTC(data) {
  return data.toISOString().slice(0, 19).replace('T', ' ');
}

function adicionarDiasISO(dataISO, dias) {
  const data = new Date(`${dataISO}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function intervaloCampanha(campanha, agora = new Date()) {
  const inicio = String(campanha.data_inicio || '').slice(0, 10);
  const fim = String(campanha.data_fim || '').slice(0, 10);
  const hoje = typeof agora === 'string' ? agora.slice(0, 10) : dataHojeSaoPaulo(agora);
  if (campanha.hora_inicio && campanha.hora_fim) {
    const inicioUTC = instanteSaoPaulo(inicio, campanha.hora_inicio);
    const fimUTC = instanteSaoPaulo(fim, campanha.hora_fim);
    const instante = typeof agora === 'string' && agora.length === 10 ? instanteSaoPaulo(agora, '00:00') : new Date(agora);
    const estado = instante < inicioUTC ? 'futura' : instante >= fimUTC ? 'encerrada' : 'ativa';
    return {
      periodo: 'personalizado', inicioStr: inicio, fimInclusivoStr: fim,
      fimStr: adicionarDiasISO(fim, 1), estado,
      inicioUTC: sqlUTC(inicioUTC), fimUTC: sqlUTC(estado === 'ativa' ? instante : fimUTC)
    };
  }
  const estado = hoje < inicio ? 'futura' : hoje > fim ? 'encerrada' : 'ativa';
  const fimConsulta = estado === 'ativa' ? (hoje < fim ? hoje : fim) : fim;
  return { periodo: 'personalizado', inicioStr: inicio, fimInclusivoStr: fim,
    fimStr: adicionarDiasISO(fimConsulta, 1), estado };
}

module.exports = { adicionarDiasISO, dataHojeSaoPaulo, instanteSaoPaulo, sqlUTC, intervaloCampanha };

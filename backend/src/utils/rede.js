const { BlockList, isIP } = require('node:net');

function normalizarIp(valor) {
  const ip = String(valor || '').trim();
  const mapeado = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapeado ? mapeado[1] : ip;
}

function validarRedes(redes) {
  if (!Array.isArray(redes) || redes.length > 100) throw new Error('Informe até 100 IPs ou faixas de rede.');
  return [...new Set(redes.map(valor => {
    if (typeof valor !== 'string') throw new Error('IP ou faixa de rede inválida.');
    const texto = valor.trim();
    const [ip, prefixo, extra] = texto.split('/');
    const familia = isIP(ip);
    if (!familia || extra !== undefined || (prefixo !== undefined &&
        (!/^\d+$/.test(prefixo) || Number(prefixo) < 1 || Number(prefixo) > (familia === 4 ? 32 : 128)))) {
      throw new Error('IP ou faixa de rede inválida. Não são permitidas faixas que liberem toda a internet.');
    }
    return texto;
  }))];
}

function pertenceRede(ip, redes) {
  const endereco = normalizarIp(ip);
  const familia = isIP(endereco);
  if (!familia) return false;
  const lista = new BlockList();
  for (const rede of validarRedes(redes)) {
    const [base, prefixo] = rede.split('/');
    const tipo = isIP(base) === 4 ? 'ipv4' : 'ipv6';
    if (prefixo === undefined) lista.addAddress(base, tipo);
    else lista.addSubnet(base, Number(prefixo), tipo);
  }
  return lista.check(endereco, familia === 4 ? 'ipv4' : 'ipv6');
}

function configurarProxy(app, valor = process.env.TRUSTED_PROXY_CIDRS) {
  const proxies = String(valor || '').split(',').map(item => item.trim()).filter(Boolean);
  app.set('trust proxy', proxies.length ? validarRedes(proxies) : false);
}

module.exports = { normalizarIp, validarRedes, pertenceRede, configurarProxy };

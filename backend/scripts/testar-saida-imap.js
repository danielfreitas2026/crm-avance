const { executarDiagnostico } = require('../src/services/imap-diagnostico.service');

async function executar() {
  const resultado = await executarDiagnostico();
  if (resultado.imap.ok) {
    console.log(`Conexão TLS com ${resultado.imap.host}:${resultado.imap.porta} estabelecida.`);
  } else {
    console.error('Falha na conexão TLS:', resultado.imap.codigo, resultado.imap.mensagem);
    process.exitCode = 1;
  }
  if (resultado.ip_saida_https.ok) {
    console.log(`IP de saída observado para HTTPS: ${resultado.ip_saida_https.ip || 'não informado'}`);
  } else {
    console.error('Não foi possível consultar o IP de saída:', resultado.ip_saida_https.codigo, resultado.ip_saida_https.mensagem);
  }
}

executar();

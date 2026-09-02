function botaoCancelarEnvio(linhaId, nomeConsultora) {
  const nome = String(nomeConsultora || '').trim();
  return {
    text: nome ? `Cancelar envio ${nome}` : 'Cancelar envio',
    callback_data: `fc:cancelar:${linhaId}`
  };
}

function botaoVendaRegistrada(linhaId) {
  return {
    text: '✅ Venda registrada',
    callback_data: `fc:info:${linhaId}:venda`
  };
}

function botaoEnvioCancelado(linhaId) {
  return {
    text: '⛔ Envio cancelado',
    callback_data: `fc:info:${linhaId}:cancelado`
  };
}

const TEXTOS_INFO = {
  venda: 'Este futuro cliente ja possui uma venda registrada.',
  cancelado: 'Este envio ja foi cancelado.'
};

function textoInfoBotao(tipo) {
  return TEXTOS_INFO[String(tipo || '')] || 'Este botao e apenas informativo.';
}

module.exports = {
  botaoCancelarEnvio,
  botaoEnvioCancelado,
  botaoVendaRegistrada,
  textoInfoBotao,
  TEXTOS_INFO
};

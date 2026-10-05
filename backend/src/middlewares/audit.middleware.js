const auditLogService = require('../services/audit-log.service');
const { montarAlteracoesAuditoria } = require('../utils/alteracoes-auditoria');

/**
 * Resolve valores estaticos ou funcoes de configuracao de auditoria.
 *
 * @param {unknown|Function} valor - Valor fixo ou funcao avaliadora.
 * @param {Object} req - Requisicao HTTP.
 * @param {unknown} body - Corpo enviado na resposta.
 * @returns {unknown} Valor resolvido.
 */
function resolverValor(valor, req, body) {
  if (typeof valor === 'function') {
    return valor(req, body);
  }

  return valor;
}

/**
 * Cria middleware que registra auditoria quando a resposta e bem-sucedida.
 *
 * @param {Object} config - Configuracao do evento.
 * @returns {Function} Middleware de auditoria.
 */
function auditar(config) {
  return function auditMiddleware(req, res, next) {
    const jsonOriginal = res.json.bind(res);
    const sendOriginal = res.send.bind(res);
    let registrado = false;

    // O serviço chama este registro dentro da transação, após persistir a edição.
    // O bloqueio da entidade garante que o estado anterior pertence a esta edição.
    req.registrarAlteracaoAuditoria = async (anterior, novo, trx, resultado = novo) => {
      const dados = resolverValor(config.dados, req, resultado) || {};
      if (Object.prototype.hasOwnProperty.call(dados, 'movimentacao') && !dados.movimentacao) {
        dados.movimentacao = {
          status_anterior: anterior.status_funil || null,
          status_novo: novo.status_funil || null
        };
      }
      await auditLogService.registrar(req, {
        acao: resolverValor(config.acao, req, resultado),
        entidade: resolverValor(config.entidade, req, resultado),
        entidade_id: resolverValor(config.entidade_id, req, resultado),
        dados: { ...dados, alteracoes_detalhadas: montarAlteracoesAuditoria(anterior, novo) }
      }, trx);
      registrado = true;
    };

    /**
     * Registra o evento de auditoria apenas para respostas bem-sucedidas.
     */
    function registrarSeSucesso(body) {
      const statusCode = res.statusCode;

      if (!registrado && statusCode >= 200 && statusCode < 400) {
        registrado = true;

        auditLogService.registrarSemBloquear(req, {
          acao: resolverValor(config.acao, req, body),
          entidade: resolverValor(config.entidade, req, body),
          entidade_id: resolverValor(config.entidade_id, req, body),
          dados: resolverValor(config.dados, req, body)
        });
      }
    }

    res.json = function jsonComAuditoria(body) {
      registrarSeSucesso(body);
      return jsonOriginal(body);
    };

    res.send = function sendComAuditoria(body) {
      registrarSeSucesso(body);
      return sendOriginal(body);
    };

    return next();
  };
}

module.exports = {
  auditar
};

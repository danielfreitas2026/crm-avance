/**
 * Controller HTTP de planilhas de leads.
 *
 * Coordena upload, processamento, divisao, exportacao e fluxo de futuros
 * clientes originados das linhas importadas.
 */
const leadPlanilhaService = require('../services/lead-planilha.service');
const leadDistribuicaoService = require('../services/lead-distribuicao.service');
const leadVendaVinculoManualService = require('../services/lead-venda-vinculo-manual.service');

/**
 * Processa index conforme as regras do dominio.
 */
async function index(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarPlanilhas());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar planilhas de mailing.' });
  }
}

/**
 * Processa store conforme as regras do dominio.
 */
async function store(req, res) {
  try {
    const planilha = await leadPlanilhaService.criarPlanilha(req.body, req.usuario.id);
    return res.status(201).json(planilha);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao criar planilha.' });
  }
}

/**
 * Processa upload conforme as regras do dominio.
 */
async function upload(req, res) {
  try {
    const planilha = await leadPlanilhaService.iniciarUpload(req, req.usuario.id);
    return res.status(201).json(planilha);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao iniciar upload.' });
  }
}

/**
 * Importa uma planilha Excel de mailing.
 */
async function importarExcel(req, res) {
  try {
    const planilha = await leadPlanilhaService.importarExcel(req, req.usuario.id);
    return res.status(201).json(planilha);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao importar XLSX.' });
  }
}
/**
 * Importa o arquivo enviado somente para a base de clientes antigos.
 */
async function importarBaseAntiga(req, res) {
  try {
    const resultado = await leadPlanilhaService.importarBaseAntigaArquivo(req, req.usuario.id);
    return res.status(201).json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao importar base antiga.' });
  }
}
/**
 * Retorna status no formato esperado pelo fluxo.
 */
async function status(req, res) {
  try {
    const planilha = await leadPlanilhaService.buscarStatus(req.params.id);

    if (!planilha) {
      return res.status(404).json({ message: 'Planilha não encontrada.' });
    }

    return res.json(planilha);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao consultar status da planilha.' });
  }
}

/**
 * Processa store linhas conforme as regras do dominio.
 */
async function storeLinhas(req, res) {
  try {
    const resultado = await leadPlanilhaService.salvarLinhasLote(req.params.id, req.body.linhas || []);
    return res.status(201).json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao salvar linhas da planilha.' });
  }
}

/**
 * Processa finalizar conforme as regras do dominio.
 */
async function finalizar(req, res) {
  try {
    const planilha = await leadPlanilhaService.finalizarPlanilha(req.params.id, req.body || {});
    return res.json(planilha);
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ message: error.message || 'Erro ao finalizar planilha.' });
  }
}

/**
 * Cria um erro HTTP com status e mensagem padronizados.
 */
async function erro(req, res) {
  try {
    const planilha = await leadPlanilhaService.marcarErroPlanilha(req.params.id, req.body?.message || req.body?.mensagem);
    return res.json(planilha);
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ message: error.message || 'Erro ao marcar erro da planilha.' });
  }
}

/**
 * Atualiza schema com o estado mais recente.
 */
async function updateSchema(req, res) {
  try {
    const planilha = await leadPlanilhaService.atualizarSchema(req.params.id, req.body.schema_colunas);

    if (!planilha) {
      return res.status(404).json({ message: 'Planilha não encontrada.' });
    }

    return res.json(planilha);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao atualizar schema.' });
  }
}

/**
 * Processa destroy conforme as regras do dominio.
 */
async function destroy(req, res) {
  try {
    await leadPlanilhaService.excluirPlanilha(req.params.id);
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Erro ao excluir planilha.'
    });
  }
}

/**
 * Retorna linhas no formato esperado pelo fluxo.
 */
async function linhas(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarLinhas(req.query));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar linhas de mailing.' });
  }
}

/**
 * Exporta  no formato esperado.
 */
async function exportar(req, res) {
  try {
    await leadPlanilhaService.exportarCsv(req.body || {}, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Erro ao exportar CSV.' });
    }
    return res.end();
  }
}

/** Exporta uma planilha individual em Excel. */
async function exportarPlanilhaXlsx(req, res) {
  try {
    const buffer = await leadPlanilhaService.gerarPlanilhaXlsx(req.params.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mailing.xlsx"');
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao exportar planilha Excel.' });
  }
}
/**
 * Processa dividir conforme as regras do dominio.
 */
async function dividir(req, res) {
  try {
    return res.json(await leadPlanilhaService.dividirLeads(req.body, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(400).json({ message: error.message || 'Erro ao dividir mailing.' });
  }
}

/**
 * Processa envios conforme as regras do dominio.
 */
async function destinatariosEnviosPlanilha(req, res) { try { return res.json(await leadPlanilhaService.listarDestinatariosEnviosPlanilha(req.params.id)); } catch (error) { console.error(error); return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao listar destinatarios do mailing.' }); } }
async function historicoDestinatariosPlanilha(req, res) { try { return res.json(await leadPlanilhaService.listarHistoricoDestinatariosPlanilha(req.params.id)); } catch (error) { console.error(error); return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao listar o historico de destinatarios.' }); } }
async function cancelarEnviosPlanilha(req, res) { try { return res.json(await leadPlanilhaService.cancelarEnviosPlanilha(req.params.id, req.body?.usuario_id, req.usuario.id)); } catch (error) { console.error(error); return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao cancelar envios do mailing.' }); } }
async function envios(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarTodosEnvios());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar envios.' });
  }
}

/**
 * Processa meus envios conforme as regras do dominio.
 */
/**
 * Atualiza o nome de um envio sem alterar a distribuicao existente.
 */
async function atualizarNomeEnvio(req, res) {
  try {
    return res.json(await leadPlanilhaService.atualizarNomeEnvio(req.params.id, req.body?.nome));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao atualizar nome do envio.' });
  }
}

async function meusEnvios(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarEnviosDoUsuario(req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar mailing recebido.' });
  }
}

async function meusMailings(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarMailingsDoUsuario(req.query, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar mailings recebidos.' });
  }
}

/**
 * Processa minhas linhas conforme as regras do dominio.
 */
async function minhasLinhas(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarLinhas(req.query, { usuarioId: req.usuario.id }));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar mailing recebido.' });
  }
}

/**
 * Atualiza meu campo com os dados informados.
 */
async function atualizarMeuCampo(req, res) {
  try {
    return res.json(await leadPlanilhaService.atualizarCampoLinhaRecebida(req.params.id, req.usuario.id, req.body || {}));
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ message: error.message || 'Erro ao atualizar lead recebido.' });
  }
}

/**
 * Exporta minhas no formato esperado.
 */
async function exportarMinhas(req, res) {
  try {
    await leadPlanilhaService.exportarCsv(req.body || {}, res, { usuarioId: req.usuario.id });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Erro ao exportar CSV.' });
    }
    return res.end();
  }
}

/**
 * Marca futuro cliente conforme a acao solicitada.
 */
function responderMarcacaoFuturoCliente(req, res, resultado) {
  const { contexto_auditoria: contextoAuditoria, ...resposta } = resultado;
  req.contextoAuditoriaFuturoCliente = contextoAuditoria || null;
  return res.json(resposta);
}

async function marcarFuturoCliente(req, res) {
  try {
    const resultado = await leadPlanilhaService.marcarComoFuturoCliente(req.params.id, req.usuario.id, req.body || {});
    return responderMarcacaoFuturoCliente(req, res, resultado);
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ message: error.message || 'Erro ao marcar futuro cliente.' });
  }
}

async function distribuirFuturoCliente(req, res) {
  try {
    return res.json(await leadPlanilhaService.enviarFuturoClienteParaDistribuicao(req.params.id, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao enviar futuro cliente para distribuicao.' });
  }
}

/**
 * Registra a avaliacao da primeira ligacao pela consultora receptora.
 */
async function avaliarPrimeiraLigacao(req, res) {
  try {
    return res.json(await leadPlanilhaService.avaliarPrimeiraLigacao(
      req.params.id,
      req.usuario.id,
      req.body || {}
    ));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao avaliar a primeira ligacao.'
    });
  }
}

/**
 * Lista futuros clientes conforme os filtros e parametros informados.
 */
async function listarFuturosClientes(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientes(req.query, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar futuros clientes.' });
  }
}

async function listarFuturosClientesRecebidos(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientesRecebidos(req.query, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar futuros clientes recebidos.' });
  }
}

/** Aceita uma indicacao e inicia o prazo para registro de contato. */
async function aceitarFuturoCliente(req, res) {
  try {
    const distribuicao = await leadDistribuicaoService.aceitar(req.params.id, req.usuario.id);
    const resultado = await leadPlanilhaService.buscarLinhaFormatada(req.params.id);
    return res.json({ ...resultado, distribuicao });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao aceitar a indicacao.' });
  }
}

/** Recusa uma indicacao e a devolve para novo encaminhamento. */
async function recusarFuturoCliente(req, res) {
  try {
    return res.json(await leadDistribuicaoService.recusar(
      req.params.id,
      req.usuario.id,
      req.body?.motivo
    ));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao recusar a indicacao.' });
  }
}

async function listarTodosFuturosClientes(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientes(req.query, null));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar o quadro de futuros clientes.' });
  }
}

async function listarFuturosClientesComConsultoras(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientesComConsultoras(req.query));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar futuros clientes com consultoras.' });
  }
}

async function listarMeusFuturosClientesEmAcompanhamento(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientesComConsultoras(
      req.query,
      req.usuario.id
    ));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar seus futuros clientes em acompanhamento.' });
  }
}

async function obterMeuFuturoClienteEmAcompanhamento(req, res) {
  try {
    return res.json(await leadPlanilhaService.buscarFuturoClienteEmAcompanhamento(
      req.params.id,
      req.usuario.id
    ));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao carregar o futuro cliente em acompanhamento.'
    });
  }
}

async function obterFuturoClienteEmAcompanhamento(req, res) {
  try {
    return res.json(await leadPlanilhaService.buscarFuturoClienteEmAcompanhamento(req.params.id));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao carregar o futuro cliente em acompanhamento.'
    });
  }
}

async function listarResponsaveisFuturosClientes(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarResponsaveisFuturosClientes());
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar responsáveis dos futuros clientes.' });
  }
}

async function historicoFuturoCliente(req, res) {
  try {
    return res.json(await leadPlanilhaService.obterHistoricoFuturoCliente(req.params.id));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao carregar o historico do futuro cliente.' });
  }
}

/** Republica no Telegram somente futuros clientes antigos que nunca foram encaminhados. */
async function republicarPendentesAntigosTelegram(req, res) {
  try {
    return res.json(await leadDistribuicaoService.republicarPendentesAntigosNoTelegram());
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Erro ao republicar futuros clientes pendentes.' });
  }
}

async function metricasFuturosClientes(req, res) {
  try {
    return res.json(await leadPlanilhaService.obterMetricasFuturosClientes(req.query));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao calcular metricas de futuros clientes.' });
  }
}

async function estatisticasResumo(req, res) {
  try {
    return res.json(await leadPlanilhaService.obterEstatisticasResumo(req.query));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Erro ao carregar o resumo estatistico.' });
  }
}

async function estatisticasMailings(req, res) {
  try {
    return res.json(await leadPlanilhaService.obterEstatisticasMailings({ ...req.query, usuario_id: req.params.usuarioId }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Erro ao carregar os mailings do usuario.' });
  }
}

async function estatisticasLinhas(req, res) {
  try {
    return res.json(await leadPlanilhaService.obterEstatisticasLinhas({
      ...req.query,
      usuario_id: req.params.usuarioId,
      envio_id: req.params.envioId
    }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Erro ao carregar os leads do mailing.' });
  }
}

/** Exporta a produtividade de primeira ligação em Excel. */
async function exportarMetricasFuturosClientes(req, res) {
  try {
    const { buffer, nome } = await leadPlanilhaService.gerarXlsxEstatisticasFuturosClientes(req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao exportar as estatísticas de futuros clientes.'
    });
  }
}

async function listarVendasCandidatas(req, res) {
  try {
    return res.json(await leadVendaVinculoManualService.listarVendasCandidatas(req.params.id, req.query?.cnpj));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao localizar vendas candidatas.' });
  }
}

async function adminVincularVenda(req, res) {
  try {
    const resultado = await leadVendaVinculoManualService.vincularVenda(
      req.params.id,
      req.body?.venda_id,
      req.usuario.id,
      req.body?.cnpj
    );
    const linha = await leadPlanilhaService.buscarLinhaFormatada(req.params.id, { incluirEstadoAtual: true });
    return res.json({ ...resultado, linha: linha.linha });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao vincular venda ao futuro cliente.' });
  }
}

async function adminDesvincularVenda(req, res) {
  try {
    const resultado = await leadVendaVinculoManualService.desvincularVenda(req.params.id, req.usuario.id);
    const linha = await leadPlanilhaService.buscarLinhaFormatada(req.params.id, { incluirEstadoAtual: true });
    return res.json({ ...resultado, linha: linha.linha });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao desvincular venda do futuro cliente.' });
  }
}

async function marcarVendaRecusada(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarVendaRecusadaLead(req.params.id, req.usuario.id, req.body || {}));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar venda recusada.' });
  }
}

async function marcarClienteRecusou(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarClienteRecusouLead(req.params.id, req.usuario.id, req.body || {}));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar recusa do cliente.' });
  }
}

async function reverterClienteRecusou(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterClienteRecusouLead(req.params.id, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter a recusa do cliente.' });
  }
}

async function marcarChamadaNaoAtendida(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarChamadaNaoAtendidaLead(req.params.id, req.usuario.id, req.body || {}));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar chamada nao atendida.' });
  }
}

async function reverterChamadaNaoAtendida(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterChamadaNaoAtendidaLead(req.params.id, req.usuario.id));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter a chamada nao atendida.' });
  }
}

async function marcarRetorno(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarRetornoLead(req.params.id, req.usuario.id, req.body || {}));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar retorno do lead.' });
  }
}

/**
 * Lista futuros clientes lixeira conforme os filtros e parametros informados.
 */
async function listarFuturosClientesLixeira(req, res) {
  try {
    return res.json(await leadPlanilhaService.listarFuturosClientesLixeira(
      req.query,
      req.usuario.id,
      { todos: Boolean(req.futurosClientesEscopoTodos) }
    ));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao listar lixeira de futuros clientes.' });
  }
}

/**
 * Exclui futuro cliente conforme a regra de negocio.
 */
async function excluirFuturoCliente(req, res) {
  try {
    const total = await leadPlanilhaService.enviarFuturoClienteParaLixeira(
      req.params.id,
      req.usuario.id,
      { todos: Boolean(req.futurosClientesEscopoTodos) }
    );

    if (!total) {
      return res.status(404).json({ message: 'Futuro cliente não encontrado.' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'Erro ao enviar futuro cliente para lixeira.' });
  }
}

/**
 * Restaura futuro cliente quando a regra de negocio permite.
 */
async function restaurarFuturoCliente(req, res) {
  try {
    const linha = await leadPlanilhaService.restaurarFuturoCliente(
      req.params.id,
      req.usuario.id,
      { todos: Boolean(req.futurosClientesEscopoTodos) }
    );

    if (!linha) {
      return res.status(404).json({ message: 'Futuro cliente não encontrado na lixeira.' });
    }

    return res.json(linha);
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'Erro ao restaurar futuro cliente.' });
  }
}

/**
 * Exclui futuro cliente definitivo conforme a regra de negocio.
 */
async function excluirFuturoClienteDefinitivo(req, res) {
  try {
    const total = await leadPlanilhaService.excluirFuturoClienteDefinitivo(
      req.params.id,
      req.usuario.id,
      { todos: Boolean(req.futurosClientesEscopoTodos) }
    );

    if (!total) {
      return res.status(404).json({ message: 'Futuro cliente não encontrado na lixeira.' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'Erro ao excluir futuro cliente definitivamente.' });
  }
}

// ─── Ações administrativas por linha (gerenciar_leads) ────────────────────────
// Reutilizam as funções de transição do serviço com { comoAdmin: true }, o que
// dispensa a checagem de dono (atribuido_para_id) e relaxa as travas de estado.

async function adminAtualizarCampoLead(req, res) {
  try {
    return res.json(await leadPlanilhaService.atualizarCampoLinhaRecebida(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao atualizar lead.' });
  }
}

async function adminMarcarFuturoCliente(req, res) {
  try {
    const resultado = await leadPlanilhaService.marcarComoFuturoCliente(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true });
    return responderMarcacaoFuturoCliente(req, res, resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao qualificar futuro cliente.' });
  }
}

async function atualizarFuturoClienteGlobal(req, res) {
  try {
    const resultado = await leadPlanilhaService.marcarComoFuturoCliente(
      req.params.id,
      req.usuario.id,
      req.body || {},
      { comoAdmin: true, exigirFuturoClienteAtivo: true }
    );
    return responderMarcacaoFuturoCliente(req, res, resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao atualizar futuro cliente.' });
  }
}

async function adminReverterFuturoCliente(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterFuturoClienteLead(req.params.id, req.usuario.id, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter o futuro cliente.' });
  }
}

async function adminMarcarVendaRecusada(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarVendaRecusadaLead(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar venda recusada.' });
  }
}

async function adminReverterVendaRecusada(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterVendaRecusadaLead(req.params.id, req.usuario.id, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter a venda recusada.' });
  }
}

async function adminMarcarClienteRecusou(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarClienteRecusouLead(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar recusa do cliente.' });
  }
}

async function adminReverterClienteRecusou(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterClienteRecusouLead(req.params.id, req.usuario.id, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter a recusa do cliente.' });
  }
}

async function adminMarcarChamadaNaoAtendida(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarChamadaNaoAtendidaLead(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar chamada nao atendida.' });
  }
}

async function adminReverterChamadaNaoAtendida(req, res) {
  try {
    return res.json(await leadPlanilhaService.reverterChamadaNaoAtendidaLead(req.params.id, req.usuario.id, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao reverter a chamada nao atendida.' });
  }
}

async function adminMarcarRetorno(req, res) {
  try {
    return res.json(await leadPlanilhaService.marcarRetornoLead(req.params.id, req.usuario.id, req.body || {}, { comoAdmin: true }));
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao marcar retorno do lead.' });
  }
}

module.exports = {
  index,
  store,
  upload,
  importarExcel,
  importarBaseAntiga,
  status,
  storeLinhas,
  finalizar,
  erro,
  updateSchema,
  destroy,
  linhas,
  exportar,
  exportarPlanilhaXlsx,
  destinatariosEnviosPlanilha,
  historicoDestinatariosPlanilha,
  cancelarEnviosPlanilha,
  dividir,
  envios,
  atualizarNomeEnvio,
  meusEnvios,
  meusMailings,
  minhasLinhas,
  atualizarMeuCampo,
  exportarMinhas,
  marcarFuturoCliente,
  distribuirFuturoCliente,
  avaliarPrimeiraLigacao,
  listarFuturosClientes,
  listarFuturosClientesRecebidos,
  aceitarFuturoCliente,
  recusarFuturoCliente,
  listarTodosFuturosClientes,
  listarFuturosClientesComConsultoras,
  listarMeusFuturosClientesEmAcompanhamento,
  obterMeuFuturoClienteEmAcompanhamento,
  obterFuturoClienteEmAcompanhamento,
  listarResponsaveisFuturosClientes,
  republicarPendentesAntigosTelegram,
  metricasFuturosClientes,
  estatisticasResumo,
  estatisticasMailings,
  estatisticasLinhas,
  exportarMetricasFuturosClientes,
  listarVendasCandidatas,
  adminVincularVenda,
  adminDesvincularVenda,
  marcarVendaRecusada,
  marcarClienteRecusou,
  reverterClienteRecusou,
  marcarChamadaNaoAtendida,
  reverterChamadaNaoAtendida,
  marcarRetorno,
  listarFuturosClientesLixeira,
  historicoFuturoCliente,
  excluirFuturoCliente,
  restaurarFuturoCliente,
  excluirFuturoClienteDefinitivo,
  adminAtualizarCampoLead,
  adminMarcarFuturoCliente,
  atualizarFuturoClienteGlobal,
  adminReverterFuturoCliente,
  adminMarcarVendaRecusada,
  adminReverterVendaRecusada,
  adminMarcarClienteRecusou,
  adminReverterClienteRecusou,
  adminMarcarChamadaNaoAtendida,
  adminReverterChamadaNaoAtendida,
  adminMarcarRetorno
};

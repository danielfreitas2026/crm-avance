/**
 * Controller HTTP de vendas.
 *
 * Centraliza listagem, cadastro, edicao, importacao, exportacao, lixeira,
 * cancelamento e operacoes de pos-venda expostas pelas rotas de vendas.
 */
const vendaService = require('../services/venda.service');
const vendaImportacaoEmpresasService = require('../services/venda-importacao-empresas.service');
const { gerarXlsxClaro } = require('../services/venda-xlsx-claro.service');
const { _internals } = require('../services/venda-email-template.service');

/**
 * Processa index conforme as regras do dominio.
 */
async function index(req, res) {
  try {
    const vendas = await vendaService.listarVendas(req.query, req.usuario.id);

    return res.json(vendas);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar vendas.'
    });
  }
}

/**
 * Processa referencias clientes conforme as regras do dominio.
 */
async function referenciasClientes(req, res) {
  try {
    const referencias = await vendaService.obterReferenciasClientes(req.usuario.id);
    return res.json(referencias);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao carregar referencias de clientes.'
    });
  }
}

/**
 * Retorna resumo no formato esperado pelo fluxo.
 */
async function resumo(req, res) {
  try {
    const resumoDashboard = await vendaService.obterResumoDashboard(req.usuario.id);

    return res.json(resumoDashboard);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao carregar resumo de vendas.'
    });
  }
}

/**
 * Processa relatorios conforme as regras do dominio.
 */
async function relatorios(req, res) {
  try {
    const relatorio = await vendaService.obterRelatoriosVendas(req.query, req.usuario.id);

    return res.json(relatorio);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao carregar relatórios de vendas.'
    });
  }
}

/**
 * Exporta  no formato esperado.
 */
async function exportar(req, res) {
  try {
    const { buffer, nome } = await vendaService.gerarXlsxVendas(req.query, req.usuario.id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao exportar vendas.'
    });
  }
}

/**
 * Processa show conforme as regras do dominio.
 */
async function show(req, res) {
  try {
    const venda = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);

    if (!venda) {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    return res.json(venda);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao buscar venda.'
    });
  }
}

/**
 * Retorna email template no formato esperado pelo fluxo.
 */
async function emailTemplate(req, res) {
  try {
    const resultado = await vendaService.gerarEmailTemplateVenda(req.params.id, req.usuario.id);

    if (!resultado) {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    return res.json(resultado);
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao gerar corpo de email.'
    });
  }
}

/**
 * Processa store conforme as regras do dominio.
 */
async function store(req, res) {
  try {
    const venda = await vendaService.criarVenda(req.body, req.usuario.id);
    const vendaCompleta = await vendaService.buscarVendaPorId(venda.id);

    return res.status(201).json(vendaCompleta);
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      message: error.message || 'Erro ao criar venda.'
    });
  }
}

/**
 * Reenvia manualmente uma venda elegivel para a integracao do dashboard.
 */
async function reenviarDashboard(req, res) {
  try {
    const resultado = await vendaService.reenviarVendaParaDashboard(req.params.id, req.usuario.id);

    if (resultado.status === 'not_found') {
      return res.status(404).json({ message: 'Venda não encontrada.' });
    }

    if (resultado.status === 'not_eligible') {
      return res.status(409).json({ message: 'Esta venda não está elegível para reenvio manual ao dashboard.' });
    }

    return res.json(resultado.integracao_dashboard);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao reenviar venda ao dashboard.' });
  }
}

/**
 * Processa preview importacao empresas conforme as regras do dominio.
 */
async function previewImportacaoEmpresas(req, res) {
  try {
    const preview = await vendaImportacaoEmpresasService.preview(req);
    return res.json(preview);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao ler planilha de vendas.'
    });
  }
}

/**
 * Importa empresas a partir dos dados recebidos.
 */
async function importarEmpresas(req, res) {
  try {
    const resultado = await vendaImportacaoEmpresasService.importar(req, req.usuario.id);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao importar vendas.'
    });
  }
}

/**
 * Processa update conforme as regras do dominio.
 */
async function update(req, res) {
  try {
    const venda = await vendaService.atualizarVenda(req.params.id, req.body, req.usuario.id);

    if (!venda) {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);

    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao atualizar venda.'
    });
  }
}

/** Registra uma reversao auditada da venda. */
async function registrarReversao(req, res) {
  try {
    const venda = await vendaService.registrarReversaoVenda(req.params.id, req.body, req.usuario.id);

    if (!venda) {
      return res.status(404).json({ message: 'Venda não encontrada.' });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);
    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao registrar reversão da venda.'
    });
  }
}

/** Oculta uma reversao preservando sua trilha de auditoria. */
async function excluirReversao(req, res) {
  try {
    const reversao = await vendaService.excluirReversaoVenda(
      req.params.id,
      req.params.reversaoId,
      req.body?.motivo,
      req.usuario.id
    );

    if (!reversao) {
      return res.status(404).json({ message: 'Venda não encontrada.' });
    }

    req.reversaoExcluida = reversao;
    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);
    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao excluir reversão da venda.'
    });
  }
}

/**
 * Atualiza status com o estado mais recente.
 */
async function updateStatus(req, res) {
  try {
    const resultado = await vendaService.atualizarStatusVenda(req.params.id, req.body, req.usuario.id);

    if (resultado.status === 'not_found') {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    if (resultado.status === 'invalid') {
      return res.status(400).json({
        message: resultado.message
      });
    }

    if (resultado.status === 'forbidden') {
      return res.status(403).json({
        message: resultado.message
      });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);

    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao atualizar status da venda.'
    });
  }
}

/**
 * Envia pos venda para processamento.
 */
async function enviarPosVenda(req, res) {
  try {
    const resultado = await vendaService.enviarVendaParaPosVenda(req.params.id, req.usuario.id, req.body);

    if (resultado.status === 'not_found') {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    if (resultado.status === 'pendente') {
      return res.status(202).json({
        message: resultado.message || 'Solicitação enviada para aprovação do ADM.',
        status: resultado.status,
        solicitacao: resultado.solicitacao
      });
    }

    if (resultado.status === 'recusada') {
      return res.status(403).json({
        message: resultado.message || 'Solicitação recusada pelo ADM.',
        status: resultado.status,
        solicitacao: resultado.solicitacao
      });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);

    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao enviar venda para o pós-venda.'
    });
  }
}

/**
 * Processa destroy conforme as regras do dominio.
 */
async function destroy(req, res) {
  try {
    const totalExcluido = await vendaService.excluirVenda(req.params.id, req.usuario.id);

    if (!totalExcluido) {
      return res.status(404).json({
        message: 'Venda não encontrada.'
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao excluir venda.'
    });
  }
}

/**
 * Processa lixeira conforme as regras do dominio.
 */
async function lixeira(req, res) {
  try {
    const vendas = await vendaService.listarVendasLixeira(req.query, req.usuario.id);

    return res.json(vendas);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar lixeira de vendas.'
    });
  }
}

/**
 * Processa restore conforme as regras do dominio.
 */
async function restore(req, res) {
  try {
    const venda = await vendaService.restaurarVenda(req.params.id, req.usuario.id);

    if (!venda) {
      return res.status(404).json({
        message: 'Venda não encontrada na lixeira.'
      });
    }

    return res.json(venda);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao restaurar venda.'
    });
  }
}

/**
 * Processa destroy definitivo conforme as regras do dominio.
 */
async function destroyDefinitivo(req, res) {
  try {
    const totalExcluido = await vendaService.excluirVendaDefinitivo(req.params.id, req.usuario.id);

    if (!totalExcluido) {
      return res.status(404).json({
        message: 'Venda não encontrada na lixeira.'
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao excluir venda definitivamente.'
    });
  }
}

/**
 * Retorna vendedoras no formato esperado pelo fluxo.
 */
async function vendedoras(req, res) {
  try {
    const usuarios = await vendaService.listarVendedoras(req.usuario.id);

    return res.json(usuarios);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar vendedoras.'
    });
  }
}

/**
 * Processa xlsx claro conforme as regras do dominio.
 */
async function xlsxClaro(req, res) {
  try {
    const venda = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);

    if (!venda) {
      return res.status(404).json({ message: 'Venda não encontrada.' });
    }

    const operadora = _internals.resolverOperadora(venda);
    if (operadora !== 'Claro') {
      return res.status(400).json({ message: 'Planilha disponível apenas para vendas Claro.' });
    }

    const buffer = await gerarXlsxClaro(venda);
    const nomeCliente = String(venda.razao_social || venda.cliente?.razao_social || venda.cliente?.nome || venda.id).replace(/[^\w\s-]/g, '').trim();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="CHEKLIST PADRAO - ${nomeCliente}.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao gerar planilha Claro.' });
  }
}

/**
 * Processa cancelar conforme as regras do dominio.
 */
async function cancelar(req, res) {
  try {
    const resultado = await vendaService.cancelarVenda(req.params.id, {
      motivo: req.body?.motivo,
      usuarioId: req.usuario.id
    });

    if (resultado.status === 'not_found') {
      return res.status(404).json({ message: 'Venda nao encontrada.' });
    }

    if (resultado.status === 'invalid') {
      return res.status(400).json({ message: resultado.message });
    }

    if (resultado.status === 'forbidden') {
      return res.status(403).json({ message: resultado.message });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);
    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao cancelar venda.' });
  }
}

/**
 * Processa reverter cancelamento conforme as regras do dominio.
 */
async function reverterCancelamento(req, res) {
  try {
    const resultado = await vendaService.reverterCancelamentoVenda(req.params.id, req.usuario.id, {
      observacao: req.body?.observacao
    });

    if (resultado.status === 'not_found') {
      return res.status(404).json({ message: 'Venda nao encontrada.' });
    }

    if (resultado.status === 'invalid') {
      return res.status(400).json({ message: resultado.message });
    }

    if (resultado.status === 'forbidden') {
      return res.status(403).json({ message: resultado.message });
    }

    const vendaCompleta = await vendaService.buscarVendaPorId(req.params.id, req.usuario.id);
    return res.json(vendaCompleta);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao reverter cancelamento da venda.' });
  }
}

module.exports = {
  index,
  resumo,
  relatorios,
  exportar,
  show,
  emailTemplate,
  xlsxClaro,
  previewImportacaoEmpresas,
  importarEmpresas,
  store,
  reenviarDashboard,
  update,
  registrarReversao,
  excluirReversao,
  updateStatus,
  cancelar,
  reverterCancelamento,
  enviarPosVenda,
  destroy,
  lixeira,
  restore,
  destroyDefinitivo,
  vendedoras,
  contagemPorCliente,
  referenciasClientes
};

/**
 * Processa contagem por cliente conforme as regras do dominio.
 */
async function contagemPorCliente(req, res) {
  try {
    const contagem = await vendaService.contarVendasConcluidasPorCliente();
    return res.json(contagem);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao obter contagem de vendas.' });
  }
}

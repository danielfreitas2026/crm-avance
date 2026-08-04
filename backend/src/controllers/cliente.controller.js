const clienteService = require('../services/cliente.service');

/**
 * Lista clientes ativos conforme filtros da query string.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resposta JSON paginada ou lista simples.
 */
async function index(req, res) {
  try {
    const clientes = await clienteService.listarClientes(req.query, req.usuario.id);

    return res.json(clientes);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar clientes.'
    });
  }
}

/**
 * Retorna um cliente ativo pelo ID informado na rota.
 *
 * @param {Object} req - Requisicao com id em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Cliente encontrado ou erro 404.
 */
async function show(req, res) {
  try {
    const cliente = await clienteService.buscarClientePorId(req.params.id, req.usuario.id);

    if (!cliente) {
      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    return res.json(cliente);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao buscar cliente.'
    });
  }
}

/**
 * Lista clientes em formato reduzido para campos de selecao.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Lista de clientes para select.
 */
async function select(req, res) {
  try {
    const clientes = await clienteService.listarClientesSelect(req.query, req.usuario.id);
    return res.json(clientes);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar clientes para selecao.'
    });
  }
}

/**
 * Exporta clientes filtrados em planilha XLSX.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Arquivo XLSX para download.
 */
async function exportar(req, res) {
  try {
    const { buffer, nome } = await clienteService.gerarXlsxClientes(req.query, req.usuario.id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao exportar clientes.'
    });
  }
}

/**
 * Verifica duplicidade de CPF/CNPJ para cadastro ou edicao de cliente.
 *
 * @param {Object} req - Requisicao com documento na rota e ignorar_id opcional.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resultado da validacao.
 */
async function verificarDocumento(req, res) {
  try {
    const resultado = await clienteService.verificarDocumentoCliente(req.params.documento, {
      ignorarId: req.query.ignorar_id
    });

    return res.json(resultado);
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao verificar documento do cliente.'
    });
  }
}

/**
 * Cria um cliente e retorna o registro completo.
 *
 * @param {Object} req - Requisicao com payload do cliente em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Cliente criado.
 */
async function store(req, res) {
  try {
    const cliente = await clienteService.criarCliente(req.body, req.usuario.id);
    const clienteCompleto = await clienteService.buscarClientePorId(cliente.id, req.usuario.id);

    return res.status(201).json(clienteCompleto);
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      message: error.message || 'Erro ao criar cliente.'
    });
  }
}

/**
 * Lê uma planilha da base anterior e retorna sugestoes de mapeamento.
 *
 * @param {Object} req - Requisicao multipart com arquivo XLSX.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Preview da importacao.
 */
async function previewImportacaoBaseAnterior(req, res) {
  try {
    const preview = await clienteService.previewImportacaoBaseAnterior(req);
    return res.json(preview);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao ler planilha.'
    });
  }
}

/**
 * Importa clientes da base anterior a partir de uma planilha mapeada.
 *
 * @param {Object} req - Requisicao multipart com arquivo e mapeamento.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resumo da importacao.
 */
async function importarBaseAnterior(req, res) {
  try {
    const resultado = await clienteService.importarBaseAnterior(req, req.usuario.id);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao importar base anterior.'
    });
  }
}

/**
 * Atualiza um cliente existente e retorna o registro completo.
 *
 * @param {Object} req - Requisicao com id na rota e campos em req.body.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Cliente atualizado ou erro 404.
 */
async function update(req, res) {
  try {
    const cliente = await clienteService.atualizarCliente(req.params.id, req.body, req.usuario.id);

    if (!cliente) {
      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    const clienteCompleto = await clienteService.buscarClientePorId(req.params.id, req.usuario.id);

    return res.json(clienteCompleto);
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      message: error.message || 'Erro ao atualizar cliente.'
    });
  }
}

/** Atualiza exclusivamente as consultoras vinculadas ao cliente. */
async function atualizarConsultoras(req, res) {
  try {
    const cliente = await clienteService.atualizarConsultorasCliente(req.params.id, req.body?.consultora_ids, req.usuario.id);
    if (!cliente) return res.status(404).json({ message: 'Cliente não encontrado.' });
    return res.json(cliente);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({ message: error.message || 'Erro ao vincular consultoras.' });
  }
}

/**
 * Move um cliente para a lixeira.
 *
 * @param {Object} req - Requisicao com id em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando removido.
 */
async function destroy(req, res) {
  try {
    const totalExcluido = await clienteService.excluirCliente(req.params.id, req.usuario.id);

    if (!totalExcluido) {
      return res.status(404).json({
        message: 'Cliente não encontrado.'
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao excluir cliente.'
    });
  }
}

/**
 * Lista clientes que estao na lixeira.
 *
 * @param {Object} req - Requisicao com filtros em req.query.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Clientes excluidos logicamente.
 */
async function lixeira(req, res) {
  try {
    const clientes = await clienteService.listarClientesLixeira(req.query, req.usuario.id);

    return res.json(clientes);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao listar lixeira de clientes.'
    });
  }
}

/**
 * Restaura um cliente removido da lixeira.
 *
 * @param {Object} req - Requisicao com id em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Cliente restaurado ou erro 404.
 */
async function restore(req, res) {
  try {
    const cliente = await clienteService.restaurarCliente(req.params.id, req.usuario.id);

    if (!cliente) {
      return res.status(404).json({
        message: 'Cliente não encontrado na lixeira.'
      });
    }

    return res.json(cliente);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Erro ao restaurar cliente.'
    });
  }
}

/**
 * Exclui definitivamente um cliente da lixeira.
 *
 * @param {Object} req - Requisicao com id e opcao de excluir vendas relacionadas.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<(Object|void)>} Status 204 quando removido.
 */
async function destroyDefinitivo(req, res) {
  try {
    const excluirVendasRelacionadas = ['1', 'true', true, 1].includes(
      req.query.excluir_vendas_relacionadas ?? req.body?.excluir_vendas_relacionadas
    );
    const totalExcluido = await clienteService.excluirClienteDefinitivo(req.params.id, req.usuario.id, {
      excluirVendasRelacionadas
    });

    if (!totalExcluido) {
      return res.status(404).json({
        message: 'Cliente não encontrado na lixeira.'
      });
    }

    return res.status(204).send();
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao excluir cliente definitivamente.',
      total_vendas_relacionadas: error.totalVendasRelacionadas
    });
  }
}

/**
 * Remove todos os clientes importados da base anterior.
 *
 * @param {Object} req - Requisicao com opcao de excluir vendas relacionadas.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Resumo da limpeza.
 */
async function limparBaseAnterior(req, res) {
  try {
    const excluirVendasRelacionadas = ['1', 'true', true, 1].includes(
      req.query.excluir_vendas_relacionadas ?? req.body?.excluir_vendas_relacionadas
    );
    const resultado = await clienteService.limparClientesBaseAnterior({
      excluirVendasRelacionadas
    });
    return res.json(resultado);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: error.message || 'Erro ao limpar clientes da base anterior.'
    });
  }
}

module.exports = {
  index,
  select,
  exportar,
  verificarDocumento,
  show,
  store,
  previewImportacaoBaseAnterior,
  importarBaseAnterior,
  update,
  atualizarConsultoras,
  destroy,
  lixeira,
  restore,
  destroyDefinitivo,
  limparBaseAnterior
};

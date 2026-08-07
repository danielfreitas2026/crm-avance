const cnpjService = require('../services/cnpj.service');
const cnpjImportacaoService = require('../services/cnpj-importacao.service');
const googlePlacesService = require('../services/google-places.service');

/**
 * Converte codigos de erro do servico de CNPJ em status HTTP.
 *
 * @param {Object} error - Erro lancado pela consulta de CNPJ.
 * @returns {number} Status HTTP correspondente.
 */
function getStatusErro(error) {
  if (error.code === 'cnpj_incompleto' || error.code === 'cnpj_invalido') return 400;
  if (error.code === 'nao_encontrado') return 404;
  if (error.code === 'limite') return 429;
  return 500;
}

/**
 * Consulta dados cadastrais de um CNPJ informado na rota.
 *
 * @param {Object} req - Requisicao com CNPJ em req.params.
 * @param {Object} res - Resposta HTTP.
 * @returns {Promise.<Object>} Dados do CNPJ ou erro mapeado.
 */
async function consultar(req, res) {
  try {
    const dados = await cnpjService.consultarCnpj(req.params.cnpj);
    return res.json(dados);
  } catch (error) {
    const status = getStatusErro(error);

    if (status >= 500) {
      console.error(error);
    }

    return res.status(status).json({
      message: error.message || 'Erro ao consultar CNPJ.'
    });
  }
}

async function previewPlanilha(req, res) {
  try {
    const preview = await cnpjImportacaoService.previewPlanilha(req);
    return res.json(preview);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao ler planilha.'
    });
  }
}

async function consultarPlanilha(req, res) {
  try {
    const resultado = await cnpjImportacaoService.consultarPlanilha(req);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || getStatusErro(error)).json({
      message: error.message || 'Erro ao consultar CNPJs da planilha.'
    });
  }
}

async function consultarPlanilhaStream(req, res) {
  /**
   * Escreve eventos newline-delimited JSON para consumo incremental no frontend.
   */
  function escreverEvento(evento) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    res.write(`${JSON.stringify(evento)}\n`);
  }

  try {
    await cnpjImportacaoService.consultarPlanilhaStream(req, escreverEvento);
    return res.end();
  } catch (error) {
    console.error(error);

    if (res.headersSent) {
      escreverEvento({
        tipo: 'erro',
        message: error.message || 'Erro ao consultar CNPJs da planilha.'
      });
      return res.end();
    }

    return res.status(error.statusCode || getStatusErro(error)).json({
      message: error.message || 'Erro ao consultar CNPJs da planilha.'
    });
  }
}

async function adicionarLeads(req, res) {
  try {
    const resultado = await cnpjImportacaoService.adicionarLeads(req.body?.linhas, req.usuario.id);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao adicionar leads.'
    });
  }
}

async function listarBuscasRealizadas(req, res) {
  try {
    const resultado = await cnpjImportacaoService.listarBuscasRealizadas(req.usuario.id);
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao listar consultas de CNPJ.'
    });
  }
}

async function excluirBuscaRealizada(req, res) {
  try {
    const total = await cnpjImportacaoService.excluirBuscaRealizada(req.params.cnpj);
    return res.json({ excluidos: total });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao excluir consulta de CNPJ.'
    });
  }
}

async function limparBuscasRealizadas(req, res) {
  try {
    const total = await cnpjImportacaoService.limparBuscasRealizadas();
    return res.json({ excluidos: total });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao limpar consultas de CNPJ.'
    });
  }
}

async function reconsultarBuscasRealizadas(req, res) {
  try {
    const resultado = await cnpjImportacaoService.reconsultarBuscasRealizadas(
      req.body?.cnpjs,
      req.usuario.id,
      { buscaTelefone: req.body?.buscaTelefone }
    );
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao buscar CNPJs novamente.'
    });
  }
}
async function exportarResultado(req, res) {
  try {
    const isMultipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
    const { buffer, nome } = isMultipart
      ? await cnpjImportacaoService.gerarXlsxResultadoUpload(req)
      : await cnpjImportacaoService.gerarXlsxResultado(req.body?.linhas, {
          nome: req.body?.nome
        });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao exportar resultado.'
    });
  }
}

async function listarGooglePlacesKeys(req, res) {
  try {
    const chaves = await cnpjImportacaoService.listarGooglePlacesKeys();
    return res.json({ chaves });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao listar chaves do Google Places.'
    });
  }
}

async function adicionarGooglePlacesKey(req, res) {
  try {
    const chave = await cnpjImportacaoService.adicionarGooglePlacesKey(req.body || {});
    return res.status(201).json(chave);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao adicionar chave do Google Places.'
    });
  }
}

async function atualizarGooglePlacesKey(req, res) {
  try {
    const chave = await cnpjImportacaoService.atualizarGooglePlacesKey(req.params.id, req.body || {});
    return res.json(chave);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao editar chave do Google Places.'
    });
  }
}

async function removerGooglePlacesKey(req, res) {
  try {
    await cnpjImportacaoService.removerGooglePlacesKey(req.params.id);
    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Erro ao remover chave do Google Places.'
    });
  }
}

/** Busca empresas no Google Places a partir de um CNPJ ou texto informado. */
async function buscarGooglePlaces(req, res) {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ message: 'Informe um CNPJ ou texto para buscar no Google.' });
  if (texto.length > 240) return res.status(400).json({ message: 'A busca pode ter no mximo 240 caracteres.' });

  try {
    const referencia = req.body?.referencia || {};
    const resultado = await googlePlacesService.buscarEmpresasPorTexto({
      queryGoogle: texto,
      razaoSocial: String(referencia.razaoSocial || '').trim(),
      nomeFantasia: String(referencia.nomeFantasia || '').trim()
    });
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao buscar no Google Places.'
    });
  }
}

/**
 * Busca o telefone da empresa no Google Places para o fluxo de futuros
 * clientes. Usa o caminho de telefone (detalhes apenas do melhor candidato,
 * 1 consulta de Place Details em vez de 5) e devolve, junto de cada candidato,
 * a confiabilidade calculada (0-100%) e a recomendacao de busca extra (Apify).
 */
async function buscarTelefoneGoogleFuturosClientes(req, res) {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) return res.status(400).json({ message: 'Informe um CNPJ ou texto para buscar no Google.' });
  if (texto.length > 240) return res.status(400).json({ message: 'A busca pode ter no maximo 240 caracteres.' });

  try {
    const referencia = req.body?.referencia || {};
    const resultado = await googlePlacesService.buscarTelefoneEmpresa({
      queryGoogle: texto,
      razaoSocial: String(referencia.razaoSocial || '').trim(),
      nomeFantasia: String(referencia.nomeFantasia || '').trim(),
      municipio: String(referencia.municipio || '').trim(),
      uf: String(referencia.uf || '').trim()
    });
    return res.json(resultado);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      message: error.message || 'Erro ao buscar no Google Places.'
    });
  }
}
module.exports = {
  adicionarLeads,
  adicionarGooglePlacesKey,
  atualizarGooglePlacesKey,
  buscarGooglePlaces,
  buscarTelefoneGoogleFuturosClientes,
  consultar,
  consultarPlanilha,
  consultarPlanilhaStream,
  excluirBuscaRealizada,
  exportarResultado,
  limparBuscasRealizadas,
  listarBuscasRealizadas,
  listarGooglePlacesKeys,
  removerGooglePlacesKey,
  previewPlanilha,
  reconsultarBuscasRealizadas
};


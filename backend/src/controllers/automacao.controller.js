const service = require('../services/automacao-email.service');

function erro(res, error) { console.error(error); return res.status(error.statusCode || 500).json({ message: error.message || 'Erro na automação.' }); }
async function index(req, res) { try { return res.json(await service.listar(req.query)); } catch (error) { return erro(res, error); } }
async function resumo(req, res) { try { return res.json(await service.resumo()); } catch (error) { return erro(res, error); } }
async function coletarHistorico(req, res) { try { return res.json(await service.coletarHistorico()); } catch (error) { return erro(res, error); } }
async function vendasCandidatas(req, res) { try { const item = await service.listarVendasCandidatas(req.params.id, req.query?.cnpj); return item ? res.json(item) : res.status(404).json({ message: 'Execução não encontrada.' }); } catch (error) { return erro(res, error); } }
async function revisar(req, res) { try { const item = await service.revisar(req.params.id, req.body, req.usuario.id); return item ? res.json(item) : res.status(404).json({ message: 'Execução não encontrada.' }); } catch (error) { return erro(res, error); } }
async function repetir(req, res) { try { const item = await service.repetir(req.params.id); return item ? res.json(item) : res.status(404).json({ message: 'Execução não encontrada.' }); } catch (error) { return erro(res, error); } }
async function repetirRevisoes(req, res) { try { return res.json(await service.repetirRevisoes()); } catch (error) { return erro(res, error); } }
async function descartar(req, res) { try { const item = await service.descartar(req.params.id, req.body?.justificativa, req.usuario.id); return item ? res.json(item) : res.status(404).json({ message: 'Execução não encontrada.' }); } catch (error) { return erro(res, error); } }
async function problemas(req, res) { try { return res.json(await service.listarProblemas(req.query)); } catch (error) { return erro(res, error); } }
async function resolverProblema(req, res) { try { const item = await service.resolverProblemaAutomatico(req.params.id, req.body?.mensagem, req.usuario.id); return item ? res.json(item) : res.status(404).json({ message: 'Problema automático não encontrado.' }); } catch (error) { return erro(res, error); } }
async function vendaProblema(req, res) { try { const item = await service.obterVendaProblemaAutomatico(req.params.id); return item ? res.json(item) : res.status(404).json({ message: 'Venda vinculada ao problema não encontrada.' }); } catch (error) { return erro(res, error); } }

module.exports = { index, resumo, coletarHistorico, vendasCandidatas, revisar, repetir, repetirRevisoes, descartar, problemas, resolverProblema, vendaProblema };

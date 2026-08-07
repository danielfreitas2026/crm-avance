const express = require('express');
const router = express.Router();

const cnpjController = require('../controllers/cnpj.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirUmaPermissao } = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.post('/google-places/buscar', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.buscarGooglePlaces);
router.post('/google-places/buscar-futuros-clientes', exigirUmaPermissao(['futuros_clientes_buscar_telefone_google']), cnpjController.buscarTelefoneGoogleFuturosClientes);
router.get('/google-places/keys', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.listarGooglePlacesKeys);
router.post('/google-places/keys', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.adicionarGooglePlacesKey);
router.put('/google-places/keys/:id', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.atualizarGooglePlacesKey);
router.delete('/google-places/keys/:id', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.removerGooglePlacesKey);
router.post('/planilha/preview', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.previewPlanilha);
router.get('/planilha/buscas-realizadas', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.listarBuscasRealizadas);
router.post('/planilha/buscas-realizadas/reconsultar', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.reconsultarBuscasRealizadas);
router.delete('/planilha/buscas-realizadas', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.limparBuscasRealizadas);
router.delete('/planilha/buscas-realizadas/:cnpj', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.excluirBuscaRealizada);
router.post('/planilha/consultar', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.consultarPlanilha);
router.post('/planilha/consultar-stream', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.consultarPlanilhaStream);
router.post('/planilha/exportar', exigirUmaPermissao(['clientes_importar_planilhas']), cnpjController.exportarResultado);
router.post('/planilha/leads', exigirUmaPermissao(['clientes_secretos_criar']), cnpjController.adicionarLeads);
router.get('/:cnpj', cnpjController.consultar);

module.exports = router;

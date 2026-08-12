const express = require('express');
const router = express.Router();

const mensagemController = require('../controllers/mensagem.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { exigirPermissao, exigirUmaPermissao } = require('../middlewares/permissao.middleware');

router.use(authMiddleware);

router.get('/admin/conversas', exigirPermissao('chat_visualizar_todas'), mensagemController.todasConversas);
router.get('/admin/conversas/:conversaKey', exigirPermissao('chat_visualizar_todas'), mensagemController.mensagensConversaInterna);
router.get('/admin/anexos/:mensagemArquivoId', exigirPermissao('chat_visualizar_todas'), mensagemController.baixarAnexoInterno);

router.get('/contatos', exigirPermissao('chat_usar'), mensagemController.contatos);
router.get('/conversas', exigirPermissao('chat_usar'), mensagemController.conversas);
router.get('/nao-lidas', exigirPermissao('chat_usar'), mensagemController.naoLidas);
router.get('/conversas/:contatoId', exigirPermissao('chat_usar'), mensagemController.mensagens);
router.patch('/conversas/:contatoId/lida', exigirPermissao('chat_usar'), mensagemController.marcarLida);
router.post('/anexos', exigirPermissao('chat_usar'), mensagemController.uploadAnexo);
router.get('/anexos/:mensagemArquivoId', exigirUmaPermissao(['chat_usar', 'chat_visualizar_todas']), mensagemController.baixarAnexo);
router.post('/lote', exigirPermissao('chat_usar'), mensagemController.enviarLote);
router.post('/', exigirPermissao('chat_usar'), mensagemController.enviar);
router.delete('/:id', exigirPermissao('chat_usar'), mensagemController.excluir);

module.exports = router;

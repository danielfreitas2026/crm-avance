const express = require('express');
const cors = require('cors');

require('dotenv').config();
const db = require('./config/database');
const usuarioRoutes = require('./routes/usuario.routes');
const roleRoutes = require('./routes/role.routes');
const authRoutes = require('./routes/auth.routes');
const permissaoRoutes = require('./routes/permissao.routes');
const auditLogRoutes = require('./routes/audit-log.routes');
const configRoutes = require('./routes/config.routes');
const campanhaRoutes = require('./routes/campanha.routes');
const vendaRoutes = require('./routes/venda.routes');
const clienteRoutes = require('./routes/cliente.routes');
const clienteSecretoRoutes = require('./routes/cliente-secreto.routes');
const leadPlanilhaRoutes = require('./routes/lead-planilha.routes');
const cnpjRoutes = require('./routes/cnpj.routes');
const clienteAntigoRoutes = require('./routes/cliente-antigo.routes');
const notificacaoRoutes = require('./routes/notificacao.routes');
const mensagemRoutes = require('./routes/mensagem.routes');
const notaRoutes = require('./routes/nota.routes');
const fechamentoRoutes = require('./routes/fechamento.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const telegramRoutes = require('./routes/telegram.routes');
const { securityHeadersMiddleware } = require('./middlewares/security-headers.middleware');

const app = express();

app.disable('x-powered-by');
app.use(securityHeadersMiddleware);

const extraAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'https://pos-venda.avancevip.net.br',
  process.env.FRONTEND_URL,
  ...extraAllowedOrigins
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use('/api/usuarios', usuarioRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/permissoes', permissaoRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/config', configRoutes);
app.use('/api/campanhas', campanhaRoutes);
app.use('/api/vendas', vendaRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/clientes-secretos', clienteSecretoRoutes);
app.use('/api/lead-planilhas', leadPlanilhaRoutes);
app.use('/api/cnpj', cnpjRoutes);
app.use('/api/clientes-antigos', clienteAntigoRoutes);
app.use('/api/notificacoes', notificacaoRoutes);
app.use('/api/mensagens', mensagemRoutes);
app.use('/api/notas', notaRoutes);
app.use('/api/fechamento', fechamentoRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/telegram', telegramRoutes);

app.get('/api/health', (req, res) => {
  return res.json({
    ok: true,
    message: 'API do sistema PÃ³s-venda estÃ¡ funcionando.'
  });
});

app.get('/api/db-test', async (req, res) => {
  try {
    const result = await db.raw('SELECT 1 + 1 AS resultado');

    return res.json({
      ok: true,
      message: 'ConexÃ£o com o banco funcionando.',
      result: result[0]
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      message: 'Erro ao conectar com o banco.',
      error: error.message
    });
  }
});

module.exports = app;

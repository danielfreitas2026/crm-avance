const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const db = require('../src/database/connection');
const { securityHeaders } = require('../src/middlewares/security-headers.middleware');

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();

      const req = http.request({ hostname: '127.0.0.1', port, path, method }, res => {
        res.resume();
        res.on('end', () => {
          server.close(error => {
            if (error) reject(error);
            else resolve(res);
          });
        });
      }).on('error', error => {
        server.close(() => reject(error));
      });
      req.end();
    });
  });
}

test.after(async () => {
  await db.destroy();
});

test('API não expõe mais listagem nem revelação de senhas', async () => {
  assert.equal((await request('/api/admin/senhas')).statusCode, 404);
  assert.equal((await request('/api/admin/senhas/1/revelar', 'POST')).statusCode, 404);
});

test('aplica headers de seguranca nas respostas da API', async () => {
  const response = await request('/api/health');

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-powered-by'], undefined);

  Object.entries(securityHeaders).forEach(([header, value]) => {
    assert.equal(response.headers[header.toLowerCase()], value);
  });
});

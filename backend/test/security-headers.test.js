const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/app');
const db = require('../src/database/connection');
const { securityHeaders } = require('../src/middlewares/security-headers.middleware');

function request(path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();

      http.get({ hostname: '127.0.0.1', port, path }, res => {
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
    });
  });
}

test.after(async () => {
  await db.destroy();
});

test('aplica headers de seguranca nas respostas da API', async () => {
  const response = await request('/api/health');

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-powered-by'], undefined);

  Object.entries(securityHeaders).forEach(([header, value]) => {
    assert.equal(response.headers[header.toLowerCase()], value);
  });
});

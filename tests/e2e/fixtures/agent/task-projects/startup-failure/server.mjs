import fs from 'node:fs';
import http from 'node:http';

const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
if (typeof config.catalogPath !== 'string' || !config.catalogPath.startsWith('data/')) {
  throw new Error('CONFIG_CATALOG_PATH_INVALID: catalogPath must reference a file inside data/');
}
const catalog = JSON.parse(fs.readFileSync(new URL(config.catalogPath, import.meta.url), 'utf8'));
const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('TASK_PORT_REQUIRED');

http
  .createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
    } else if (request.method === 'GET' && request.url === '/catalog') {
      response.end(JSON.stringify(catalog));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not_found' }));
    }
  })
  .listen(port, '127.0.0.1');

import http from 'node:http';
import { WorkerGateway } from './gateway';
const gateway = new WorkerGateway();
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(gateway.snapshot()));
    return;
  }
  response.statusCode = 404;
  response.end();
});
server.listen(8788, '127.0.0.1');

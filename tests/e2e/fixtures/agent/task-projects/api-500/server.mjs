import http from 'node:http';
import { readFile } from 'node:fs/promises';

const server = http.createServer(async (request, response) => {
	const requestId = request.headers['x-request-id'] ?? 'unknown';
	try {
		if (request.url === '/health') {
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify({ status: 'ok' }));
			return;
		}
		if (request.url === '/catalog') {
			const catalog = JSON.parse(await readFile(new URL('./data/catalog.json', import.meta.url), 'utf8'));
			const items = catalog.products.map((item) => ({ id: item.id, price: item.price }));
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify({ items, revision: catalog.revision }));
			return;
		}
		response.writeHead(404).end();
	} catch (error) {
		console.error(JSON.stringify({ requestId, path: request.url, error: error.stack }));
		response.writeHead(500, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: 'INTERNAL_ERROR', requestId }));
	}
});
server.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }));
process.on('SIGTERM', () => {
	server.closeAllConnections();
	server.close();
});

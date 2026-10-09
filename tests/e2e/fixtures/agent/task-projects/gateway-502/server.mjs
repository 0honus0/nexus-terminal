import http from 'node:http';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const socket = path.resolve('./upstream.sock');
const upstream = http.createServer(async (request, response) => {
	response.setHeader('Content-Type', 'application/json');
	if (request.url === '/health') response.end(JSON.stringify({ status: 'ok', service: 'upstream' }));
	else if (request.url === '/catalog') response.end(await readFile(new URL('./data/catalog.json', import.meta.url)));
	else response.writeHead(404).end();
});
const gateway = http.createServer((request, response) => {
	const requestId = request.headers['x-request-id'] ?? 'unknown';
	const forwarded = http.request(
		{
			socketPath: path.resolve(config.upstreamSocket),
			path: request.url,
			method: request.method,
			headers: request.headers,
		},
		(remote) => {
			response.writeHead(remote.statusCode, remote.headers);
			remote.pipe(response);
		},
	);
	forwarded.on('error', (error) => {
		console.error(
			JSON.stringify({ requestId, path: request.url, upstreamSocket: config.upstreamSocket, code: error.code }),
		);
		response.writeHead(502, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify({ error: 'BAD_GATEWAY', requestId }));
	});
	request.pipe(forwarded);
});
upstream.listen(socket, () =>
	gateway.listen(0, '127.0.0.1', () => process.send?.({ port: gateway.address().port, socket })),
);
process.on('SIGTERM', async () => {
	gateway.closeAllConnections();
	upstream.closeAllConnections();
	await Promise.all([
		new Promise((resolve) => gateway.close(resolve)),
		new Promise((resolve) => upstream.close(resolve)),
	]);
	await unlink(socket).catch((error) => {
		if (error.code !== 'ENOENT') throw error;
	});
});

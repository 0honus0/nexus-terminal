import { chromium } from '@playwright/test';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');

// Dedicated Chromium owned by this fixture, never the user's browser.
const cdpPort = Number(process.env.NEXUS_E2E_BROWSER_CDP_PORT || 29094);
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const upstreamPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${upstreamPort}`] });
const session = await browser.newBrowserCDPSession();
let holdNextCreation = false;
let heldResponse = null;
let releaseTimer;

const release = () => {
	clearTimeout(releaseTimer);
	const held = heldResponse;
	heldResponse = null;
	if (held && held.client.readyState === WebSocket.OPEN) held.client.send(held.bytes, { binary: false });
};

const discovery = await fetch(`http://127.0.0.1:${upstreamPort}/json/version`).then((response) => response.json());
const proxy = http.createServer((_request, response) => {
	response.writeHead(200, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify({ ...discovery, webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/browser` }));
});
const sockets = new WebSocketServer({ server: proxy });
sockets.on('connection', (client) => {
	const upstream = new WebSocket(discovery.webSocketDebuggerUrl);
	const queued = [];
	let heldId = null;
	client.on('message', (bytes) => {
		const command = JSON.parse(bytes.toString());
		if (holdNextCreation && command.method === 'Browser.setDownloadBehavior') {
			holdNextCreation = false;
			heldId = command.id;
		}
		if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: false });
		else queued.push(bytes);
	});
	upstream.on('open', () => queued.splice(0).forEach((bytes) => upstream.send(bytes, { binary: false })));
	upstream.on('message', (bytes) => {
		const message = JSON.parse(bytes.toString());
		if (heldId !== null && message.id === heldId) {
			heldId = null;
			heldResponse = { client, bytes };
			releaseTimer = setTimeout(release, 30000);
			return;
		}
		if (client.readyState === WebSocket.OPEN) client.send(bytes, { binary: false });
	});
	client.on('close', () => {
		if (heldResponse?.client === client) release();
		upstream.close();
	});
	upstream.on('close', () => client.close());
	upstream.on('error', () => client.close());
	client.on('error', () => upstream.close());
});
proxy.listen(cdpPort, '127.0.0.1');
await once(proxy, 'listening');
const server = http.createServer(async (request, response) => {
	try {
		if (request.url === '/creation-barrier') {
			if (request.method === 'POST') {
				if (holdNextCreation || heldResponse) {
					response.writeHead(409);
					response.end();
					return;
				}
				holdNextCreation = true;
			}
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ armed: holdNextCreation, held: heldResponse !== null }));
			return;
		}
		if (request.url === '/creation-barrier/release' && request.method === 'POST') {
			holdNextCreation = false;
			release();
			response.writeHead(200);
			response.end();
			return;
		}
		if (request.url !== '/contexts') {
			response.writeHead(404);
			response.end();
			return;
		}
		const contexts = await session.send('Target.getBrowserContexts');
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify(contexts));
	} catch {
		response.writeHead(500);
		response.end();
	}
});
server.listen(Number(process.env.NEXUS_E2E_BROWSER_CONTROL_PORT || 29093), '127.0.0.1');

const shutdown = async () => {
	release();
	sockets.clients.forEach((client) => client.terminate());
	sockets.close();
	proxy.close();
	server.close();
	await browser.close();
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

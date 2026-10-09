import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/workspace/packages/backend/package.json');
const { WebSocketServer } = require('ws');
const sessions = new Map();
const server = createServer((request, response) => {
	response.setHeader('Content-Type', 'application/json');
	response.end(JSON.stringify(sessions.get(request.url.slice(1)) ?? null));
});
new WebSocketServer({ server, perMessageDeflate: false }).on('connection', (socket) => {
	let token;
	socket.on('message', (bytes, binary) => {
		if (!binary) {
			token = bytes.toString();
			sessions.set(token, { started: true, closed: false });
			if (token.startsWith('disconnect:')) {
				socket.terminate();
				return;
			}
			const block = Buffer.alloc(1024 * 1024);
			for (let index = 0; index < block.length; index++) block[index] = index % 251;
			for (let index = 0; index < 8; index++) socket.send(block, { binary: true });
		} else socket.send(bytes, { binary });
	});
	socket.once('close', () => {
		if (token) sessions.set(token, { started: true, closed: true });
	});
});
server.listen(3001, '0.0.0.0');

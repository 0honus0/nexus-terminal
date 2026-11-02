import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { Ssh2MachineFactory } from '../../../packages/backend/dist/platform/ssh/adapters/ssh2/ssh-machine.js';

const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const { Server } = requireBackend('ssh2');
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
	type: 'pkcs1',
	format: 'pem',
});

async function within(promise, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 8000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const peers = new Set();
const sshClients = new Set();
const servers = [];
const machines = [];
let blackhole = false;
let receivedFin = 0;

function ownSocket(socket) {
	peers.add(socket);
	socket.on('error', () => undefined);
	socket.once('close', () => peers.delete(socket));
	return socket;
}

async function listen(server) {
	servers.push(server);
	server.listen(0, '127.0.0.1');
	await within(once(server, 'listening'), 'fixture listening');
	return server.address().port;
}

const endpoint = (port, route = { kind: 'direct' }) => ({
	host: '127.0.0.1',
	port,
	username: 'isolated-test',
	authentication: { kind: 'password', password: 'fixture-secret' },
	route,
});

try {
	const ssh = new Server({ hostKeys: [hostKey] }, (client) => {
		sshClients.add(client);
		client.on('error', () => undefined);
		client.once('close', () => sshClients.delete(client));
		client.on('authentication', (auth) => {
			if (auth.method === 'password' && auth.password === 'fixture-secret') auth.accept();
			else auth.reject();
		});
		client.on('ready', () => {
			client.on('tcpip', (accept, reject, info) => {
				const target = ownSocket(net.connect({ host: '127.0.0.1', port: info.destPort }));
				target.once('connect', () => {
					const channel = ownSocket(accept());
					target.pipe(channel).pipe(target);
					channel.once('close', () => target.destroy());
				});
				target.once('error', () => reject());
			});
		});
	});
	const sshPort = await listen(ssh);
	// Relay forwards a real SSH handshake, then drops application writes and withholds
	// its FIN. This recreates the writable=false transport on which ssh2.destroy is a no-op.
	const relay = net.createServer({ allowHalfOpen: true }, (socket) => {
		ownSocket(socket);
		const target = ownSocket(net.connect({ host: '127.0.0.1', port: sshPort }));
		socket.on('data', (data) => {
			if (!blackhole) target.write(data);
		});
		target.on('data', (data) => {
			if (!blackhole) socket.write(data);
		});
		socket.on('end', () => receivedFin++);
	});
	const relayPort = await listen(relay);
	const proxyPort = await listen(
		net.createServer({ allowHalfOpen: true }, (socket) => {
			ownSocket(socket);
			let headers = Buffer.alloc(0);

			const handshake = (data) => {
				headers = Buffer.concat([headers, data]);
				const end = headers.indexOf('\r\n\r\n');
				if (end < 0) return;
				socket.off('data', handshake);
				const target = ownSocket(net.connect({ host: '127.0.0.1', port: relayPort }));
				target.once('connect', () => {
					socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
					if (headers.length > end + 4) target.write(headers.subarray(end + 4));
					socket.pipe(target).pipe(socket);
				});
			};

			socket.on('data', handshake);
		}),
	);
	const socksPort = await listen(
		net.createServer({ allowHalfOpen: true }, (socket) => {
			ownSocket(socket);
			let input = Buffer.alloc(0);
			let greeting = true;

			const handshake = (data) => {
				input = Buffer.concat([input, data]);
				if (greeting) {
					if (input.length < 3) return;
					assert.deepEqual(input.subarray(0, 3), Buffer.from([5, 1, 0]));
					input = input.subarray(3);
					greeting = false;
					socket.write(Buffer.from([5, 0]));
				}
				if (input.length < 5 || input.length < 7 + input[4]) return;
				const end = 7 + input[4];
				socket.off('data', handshake);
				const target = ownSocket(net.connect({ host: '127.0.0.1', port: relayPort }));
				target.once('connect', () => {
					socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
					if (input.length > end) target.write(input.subarray(end));
					socket.pipe(target).pipe(socket);
				});
			};

			socket.on('data', handshake);
		}),
	);
	const factory = new Ssh2MachineFactory();
	const options = {
		timeoutMs: 5000,

		verifyHostKey: () => true,
	};
	for (const [name, target] of [
		['direct', endpoint(relayPort)],
		[
			'HTTP proxy',
			endpoint(relayPort, {
				kind: 'proxy',
				proxy: { type: 'HTTP', host: '127.0.0.1', port: proxyPort, username: null, password: null },
			}),
		],
		[
			'SOCKS5 proxy',
			endpoint(relayPort, {
				kind: 'proxy',
				proxy: { type: 'SOCKS5', host: '127.0.0.1', port: socksPort, username: null, password: null },
			}),
		],
		['jump', endpoint(relayPort, { kind: 'jump', hops: [endpoint(sshPort)] })],
	]) {
		blackhole = false;
		const machine = await within(factory.connect(target, options), name + ' handshake');
		machines.push(machine);
		assert.equal(machine.isOpen, true);
		const previousFin = receivedFin;
		blackhole = true;
		const closing = machine.close();
		assert.equal(machine.close(), closing, 'concurrent close shares its outcome');
		await within(closing, name + ' half-close cleanup');
		assert.equal(machine.isOpen, false);
		if (name !== 'jump') assert.ok(receivedFin > previousFin, 'peer withheld FIN after local end');
		console.log('Real SSH2 ' + name + ' half-closed transport cleanup PASS');
	}
	blackhole = false;
	const healthy = await within(factory.connect(endpoint(sshPort), options), 'healthy handshake');
	machines.push(healthy);
	await within(healthy.close(), 'healthy graceful cleanup');
	console.log('Real SSH2 graceful transport cleanup PASS');
} finally {
	for (const machine of machines) await machine.close().catch(() => undefined);
	for (const client of sshClients) client.end();
	for (const socket of peers) socket.destroy();
	await Promise.all(
		servers.map((server) => within(new Promise((resolve) => server.close(resolve)), 'fixture close')),
	);
}

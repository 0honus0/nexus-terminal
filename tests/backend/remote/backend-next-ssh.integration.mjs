import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket from '../../../packages/backend-next/node_modules/ws/index.js';
import { createApp } from '../../../packages/backend-next/dist/bootstrap/create-app.js';
import { openHttpListener } from '../../../packages/backend-next/dist/platform/http/http-server.js';
import { RemoteSessionOwner } from '../../../packages/backend-next/dist/modules/remote/sessions/service/session-owner.js';
import { createRemoteWebSocketRoute } from '../../../packages/backend-next/dist/modules/remote/interfaces/http/remote-http.js';

const requireBackendNext = createRequire(new URL('../../../packages/backend-next/package.json', import.meta.url));
const { Server, utils } = requireBackendNext('ssh2');

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function within(value, name, timeout = 8000) {
	let timer;
	try {
		return await Promise.race([
			value,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Timed out: ' + name)), timeout);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const directory = await mkdtemp(join(tmpdir(), 'nexus-next-real-ssh-'));
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
	type: 'pkcs1',
	format: 'pem',
});
const hostPublicKey = utils.parseKey(privateKey).getPublicSSH();
const fingerprint = 'SHA256:' + createHash('sha256').update(hostPublicKey).digest('base64').replace(/=+$/u, '');
const shellReady = deferred();
const server = new Server({ hostKeys: [privateKey] }, (client) => {
	client.on('error', () => undefined);
	client.on('authentication', (auth) => {
		if (auth.method === 'password' && auth.username === 'operator' && auth.password === 'secret') {
			auth.accept();
		} else {
			auth.reject();
		}
	});
	client.on('ready', () => {
		client.on('session', (accept) => {
			const session = accept();
			session.on('pty', (reply) => reply());
			session.on('shell', (reply) => {
				const channel = reply();
				shellReady.resolve(channel);
			});
		});
	});
});
let app;
let listener;
let owner;
let socket;
try {
	server.listen(0, '127.0.0.1');
	await within(once(server, 'listening'), 'SSH listening');
	const port = server.address().port;
	app = await createApp(join(directory, 'real.db'), { encryptionKey: randomBytes(32) });
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port, fingerprint });
	const target = await app.targets.create({
		name: 'real SSH fixture',
		type: 'SSH',
		host: '127.0.0.1',
		port,
		username: 'operator',
		route: 'direct',
		proxyId: null,
		tagIds: [],
		jumpIds: [],
		notes: null,
		rdpRemoteApp: null,
		rdpRemoteAppDirectory: null,
		rdpRemoteAppArguments: null,
	});
	const saved = await app.targets.credentials.set(target.id, target.version, {
		kind: 'password',
		password: 'secret',
	});
	assert.equal(saved.status, 'updated');

	const access = { authenticate: async (token) => (token === 'good' ? { userId: 1 } : null) };
	owner = new RemoteSessionOwner(access, app.remote);
	const session = await within(
		owner.open('good', {
			targetId: target.id,
			columns: 80,
			rows: 24,
			timeoutMs: 5000,
		}),
		'SSH PTY open',
	);
	const channel = await within(shellReady.promise, 'server PTY shell');
	listener = await openHttpListener({
		port: 0,
		bindHost: '127.0.0.1',
		publicOrigin: 'http://127.0.0.1:0',
		trustedProxies: [],
		routes: [],
		webSockets: [createRemoteWebSocketRoute(owner, app.remote)],
	});

	socket = new WebSocket('ws://' + listener.address + '/api/v1/remote/stream?sessionId=' + session.id, {
		origin: 'http://127.0.0.1:0',
		headers: {
			Host: '127.0.0.1:0',
			'Sec-Fetch-Site': 'same-origin',
			Cookie: 'nexus_session=good',
		},
	});
	const events = [];
	const ready = deferred();
	const output = deferred();
	const terminal = deferred();
	const closed = once(socket, 'close');
	socket.on('message', (value) => {
		const event = JSON.parse(value.toString());
		events.push(event);
		if (event.type === 'ready') ready.resolve();
		if (event.type === 'data') output.resolve(event);
		if (event.type === 'closed') terminal.resolve();
	});
	await within(once(socket, 'open'), 'WS open');
	await within(ready.promise, 'remote ready');
	const last = Buffer.from('actual SSH PTY tail: FIN\n', 'utf8');
	channel.write(last);
	channel.exit(0);
	channel.end();

	const received = await within(output.promise, 'real SSH final output');
	assert.equal(Buffer.from(received.data, 'base64').toString(), last.toString());
	assert.equal(
		events.some((event) => event.type === 'closed'),
		false,
	);
	socket.send(JSON.stringify({ type: 'consumed', bytes: last.length }));
	await within(terminal.promise, 'SSH EOF event after ACK').catch((error) => {
		console.error('SSH EOF diagnostics', {
			events: events.map((event) => ({ type: event.type, code: event.code })),
			sessionStillActive: app.remote.get(session.id) !== null,
		});
		throw error;
	});
	const [code] = await within(closed, 'real SSH WebSocket close');
	assert.equal(code, 1000);
	assert.deepEqual(
		events.map((event) => event.type),
		['ready', 'data', 'closed'],
	);
	console.log('Real SSH2 PTY → Remote owner → WebSocket → consumed → normal EOF PASS');
} finally {
	socket?.terminate();
	if (listener) await within(listener.close(), 'listener close');
	if (owner) await within(owner.close(), 'owner close');
	if (app) await within(app.close(), 'app close');
	await within(new Promise((resolve) => server.close(resolve)), 'SSH server close');
	await rm(directory, { recursive: true, force: true });
}

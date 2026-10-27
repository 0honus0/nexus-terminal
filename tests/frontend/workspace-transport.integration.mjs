import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from '../../packages/backend/node_modules/ws/index.js';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import {
	encodeWorkspaceBinaryFrame,
	decodeWorkspaceBinaryFrame,
} from '../../packages/shared/dist/remote/workspace/workspace-binary.js';
import { WORKSPACE_BINARY_MAX_PAYLOAD_BYTES } from '../../packages/shared/dist/remote/workspace/values.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const { WebSocketServer } = WebSocket;

const body = Uint8Array.of(0, 255, 10, 13);
const terminal = encodeWorkspaceBinaryFrame('terminal', undefined, body);
assert.deepEqual(decodeWorkspaceBinaryFrame(terminal).data, body);
const id = '\ufeff请求';
const response = encodeWorkspaceBinaryFrame('response', id, body, true);
assert.equal(decodeWorkspaceBinaryFrame(response).requestId, id, 'UTF-8 request identity retains an initial BOM');
const container = new Uint8Array(response.length + 10);
container.set(response, 5);
assert.deepEqual(decodeWorkspaceBinaryFrame(container.subarray(5, 5 + response.length)).data, body);
assert.equal(
	decodeWorkspaceBinaryFrame(
		encodeWorkspaceBinaryFrame('terminal', undefined, new Uint8Array(WORKSPACE_BINARY_MAX_PAYLOAD_BYTES)),
	).data.length,
	WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
);
assert.equal(
	decodeWorkspaceBinaryFrame(encodeWorkspaceBinaryFrame('response', 'x'.repeat(128), new Uint8Array(), true))
		.requestId.length,
	128,
);
let rejected = 0;
for (const mutate of [
	(frame) => frame.subarray(0, 15),
	(frame) => frame.subarray(0, frame.length - 1),
	(frame) => Uint8Array.from([...frame, 0]),
	(frame) => {
		frame[0] = 0;
		return frame;
	},
	(frame) => {
		frame[4] = 2;
		return frame;
	},
	(frame) => {
		frame[5] = 3;
		return frame;
	},
	(frame) => {
		frame[6] = 2;
		return frame;
	},
	(frame) => {
		frame[7] = 1;
		return frame;
	},
	(frame) => {
		frame[10] = 1;
		return frame;
	},
	(frame) => {
		frame[16] = 255;
		return frame;
	},
	(frame) => {
		new DataView(frame.buffer).setUint16(8, 129);
		return frame;
	},
	(frame) => {
		new DataView(frame.buffer).setUint32(12, WORKSPACE_BINARY_MAX_PAYLOAD_BYTES + 1);
		return frame;
	},
]) {
	assert.throws(() => decodeWorkspaceBinaryFrame(mutate(response.slice())));
	rejected += 1;
}
const finalTerminal = terminal.slice();
finalTerminal[6] = 1;
assert.throws(() => decodeWorkspaceBinaryFrame(finalTerminal));
console.log('NXW1 codec: 5 valid boundaries and ' + (rejected + 1) + ' invalid frames PASS');

const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-transport-'));
const producer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
const calls = [];
producer.on('connection', (socket) => {
	socket.on('message', (raw) => {
		const request = JSON.parse(raw.toString());
		calls.push(request);
		if (!request.requestId) return;
		const { requestId } = request;

		const reply = () =>
			socket.send(JSON.stringify({ type: 'response', requestId, payload: { ok: true, data: null } }));

		const piece = () => socket.send(encodeWorkspaceBinaryFrame('response', requestId, body));

		const final = () => socket.send(encodeWorkspaceBinaryFrame('response', requestId, new Uint8Array(), true));

		switch (request.payload?.path) {
			case '/json-first':
				reply();
				piece();
				final();
				break;
			case '/binary-first':
				piece();
				final();
				reply();
				break;
			case '/empty':
				final();
				reply();
				break;
			case '/foreign':
				socket.send(encodeWorkspaceBinaryFrame('response', 'another-request', body, true));
				piece();
				final();
				reply();
				break;
			case '/duplicate-json':
				reply();
				reply();
				final();
				break;
			case '/duplicate-final':
				final();
				final();
				reply();
				break;
			case '/after-final':
				final();
				piece();
				reply();
				break;
			case '/bad-json':
				socket.send('{');
				break;
			case '/ambiguous-success':
				socket.send(
					JSON.stringify({
						type: 'response',
						requestId,
						payload: { ok: true, data: null, error: 'conflict' },
					}),
				);
				break;
			case '/ambiguous-failure':
				socket.send(
					JSON.stringify({
						type: 'response',
						requestId,
						payload: { ok: false, data: null, error: 'conflict' },
					}),
				);
				break;
			case '/empty-failure':
				socket.send(JSON.stringify({ type: 'response', requestId, payload: { ok: false, error: '' } }));
				break;
			case '/bad-binary':
				socket.send(Uint8Array.of(1));
				break;
			case '/overflow':
				piece();
				piece();
				final();
				reply();
				break;
			case '/terminal':
				socket.send(terminal);
				reply();
				break;
			default:
				reply();
				break;
		}
	});
});
let vite;
let browser;
try {
	await once(producer, 'listening');
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port: 0,
			proxy: { '/ws/workspace': { target: 'ws://127.0.0.1:' + producer.address().port, ws: true } },
		},
		plugins: [
			{
				name: 'isolated-workspace-transport-page',

				configureServer(server) {
					server.middlewares.use('/__c2_fixture', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Workspace transport</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__c2_fixture');
	const result = await page.evaluate(async () => {
		const { WorkspaceSocket } = await import('/src/runtimes/workspace/protocol/workspaceSocket.ts');
		const results = [];
		const sockets = [];

		const make = () => {
			const socket = new WorkspaceSocket();
			sockets.push(socket);
			return socket;
		};

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			results.push(name);
		};

		try {
			for (const maxBytes of [NaN, 0, 64 * 1024 * 1024 + 1]) {
				const socket = make();
				const invalid = await socket
					.requestBinary('filesystem.readBinary', { path: '/invalid-budget', maxBytes })
					.then(
						() => false,
						() => true,
					);
				expect(invalid && !socket.connected, 'invalid budget rejected before opening: ' + String(maxBytes));
			}
			for (const path of ['/json-first', '/binary-first', '/empty', '/foreign']) {
				const socket = make();
				const result = await socket.requestBinary('filesystem.readBinary', { path, maxBytes: 4 });
				expect(result.data === null && String(result.bytes) === (path === '/empty' ? '' : '0,255,10,13'), path);
				socket.close();
			}
			for (const path of [
				'/duplicate-json',
				'/duplicate-final',
				'/after-final',
				'/bad-json',
				'/bad-binary',
				'/ambiguous-success',
				'/ambiguous-failure',
				'/empty-failure',
			]) {
				const socket = make();
				let closes = 0;
				socket.onClose(() => {
					closes += 1;
				});
				const started = performance.now();
				const outcome = await socket.requestBinary('filesystem.readBinary', { path, maxBytes: 4 }).then(
					() => 'resolved',
					() => 'rejected',
				);
				expect(
					outcome === 'rejected' && closes === 1 && !socket.connected && performance.now() - started < 5000,
					path,
				);
			}
			const sameId = make();
			const concurrent = await Promise.allSettled([
				sameId.requestWithId('workspace.ping', 'shared-opening', {}),
				sameId.requestWithId('workspace.ping', 'shared-opening', {}),
			]);
			expect(
				concurrent[0].status === 'fulfilled' && concurrent[1].status === 'rejected',
				'duplicate ID during opening',
			);
			sameId.close();
			const overflow = make();
			const overLimit = await overflow
				.requestBinary('filesystem.readBinary', { path: '/overflow', maxBytes: 4 })
				.then(
					() => false,
					() => true,
				);
			expect(overLimit && overflow.connected, 'binary response obeys original request budget');
			overflow.close();
			const output = make();
			let consume;
			output.onBinary((_bytes, consumed) => {
				consume = consumed;
			});
			await output.request('workspace.ping', { path: '/terminal' });
			expect(typeof consume === 'function', 'terminal output has consumer callback');
			consume();
			consume();
			await new Promise((resolve) => setTimeout(resolve, 80));
			// Keep a second output unconsumed to check attachment identity, rather
			// than merely calling an already acknowledged callback after reconnect.
			await output.request('workspace.ping', { path: '/terminal' });
			output.close();
			await output.open();
			consume();
			await new Promise((resolve) => setTimeout(resolve, 80));
			expect(output.connected, 'late consumption cannot close replacement attachment');
			output.close();
			const failed = make();
			await failed.open();
			const controller = new AbortController();
			let attached = 0;
			let added = 0;
			const add = controller.signal.addEventListener.bind(controller.signal);
			const remove = controller.signal.removeEventListener.bind(controller.signal);
			controller.signal.addEventListener = (...args) => {
				if (args[0] === 'abort') {
					attached += 1;
					added += 1;
				}
				return add(...args);
			};
			controller.signal.removeEventListener = (...args) => {
				if (args[0] === 'abort') attached -= 1;
				return remove(...args);
			};
			const nativeSend = WebSocket.prototype.send;
			let failure;
			try {
				WebSocket.prototype.send = () => {
					throw new DOMException('Controlled send rejection', 'InvalidStateError');
				};
				failure = await failed
					.requestBinary('filesystem.readBinary', { path: '/send-failure', maxBytes: 4 }, controller.signal)
					.then(
						() => false,
						() => true,
					);
			} finally {
				WebSocket.prototype.send = nativeSend;
			}
			expect(failure && added === 1 && attached === 0, 'dispatch rejection releases abort listener');
			return results;
		} finally {
			for (const socket of sockets) socket.close();
		}
	});
	assert.equal(calls.filter((call) => call.requestId === 'shared-opening').length, 1);
	assert.equal(
		calls.filter((call) => call.payload?.path === '/invalid-budget' || call.payload?.path === '/send-failure')
			.length,
		0,
	);
	assert.equal(
		calls.filter((call) => call.type === 'filesystem.cancelRead').length,
		1,
		'overflow cancellation uses current attachment',
	);
	const consumption = calls.filter((call) => call.type === 'terminal.flow').map((call) => call.payload.consumedBytes);
	assert.equal(consumption.filter((bytes) => bytes === body.length).length, 1, 'same output acknowledged once');
	assert.equal(consumption.at(-1), 0, 'stale callback does not acknowledge replacement attachment');
	console.log('Workspace real browser / controlled WebSocket producer: ' + result.length + ' checks PASS');
	console.log(result.join('\n'));
} finally {
	const resources = [
		() => browser?.close(),
		() => vite?.close(),
		async () => {
			for (const socket of producer.clients) socket.terminate();
			await new Promise((resolve, reject) => producer.close((error) => (error ? reject(error) : resolve())));
		},
	];
	const outcomes = await Promise.allSettled(resources.map((close) => Promise.resolve().then(close)));
	const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'Workspace transport fixture cleanup failed');
}

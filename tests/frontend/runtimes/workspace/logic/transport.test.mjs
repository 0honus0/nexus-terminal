// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { encodeWorkspaceBinaryFrame } from '@nexus-terminal/shared/remote/workspace/workspace-binary';
import { openWorkspacePeer } from '../../../../support/protocols/workspace-peer.mjs';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('workspace socket preserves response ordering, backpressure and attachment ownership over real WS', async () => {
	const peer = await openWorkspacePeer();
	const producer = peer.server;
	const body = Uint8Array.of(0, 255, 10, 13);
	const terminal = encodeWorkspaceBinaryFrame('terminal', undefined, body);
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
	try {
		vi.stubGlobal('WebSocket', peer.WebSocket);
		vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor);
		const { WorkspaceSocket } =
			await import('../../../../../packages/frontend/src/runtimes/workspace/protocol/workspaceSocket.ts');
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
			for (const maxBytes of [NaN, 0, Number.MAX_SAFE_INTEGER + 1]) {
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
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			consume();
			consume();
			await vi.advanceTimersByTimeAsync(80);
			vi.useRealTimers();
			await output.request('workspace.ping');
			// Keep a second output unconsumed to check attachment identity, rather
			// than merely calling an already acknowledged callback after reconnect.
			await output.request('workspace.ping', { path: '/terminal' });
			output.close();
			await output.open();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			consume();
			await vi.advanceTimersByTimeAsync(80);
			vi.useRealTimers();
			await output.request('workspace.ping');
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
		} finally {
			for (const socket of sockets) socket.close();
		}
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
		const consumption = calls
			.filter((call) => call.type === 'terminal.flow')
			.map((call) => call.payload.consumedBytes);
		assert.equal(consumption.filter((bytes) => bytes === body.length).length, 1, 'same output acknowledged once');
		assert.equal(consumption.at(-1), 0, 'stale callback does not acknowledge replacement attachment');
	} finally {
		await peer.close();
	}
});

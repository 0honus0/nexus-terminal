// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import WebSocket from '../../../../../packages/backend/node_modules/ws/index.js';
import { openWorkspacePeer } from '../../../../support/protocols/workspace-peer.mjs';

afterEach(() => vi.unstubAllGlobals());

test('workspace terminal adapters preserve wire ordering, refusal and ownership with a real peer', async () => {
	const peer = await openWorkspacePeer();
	const producer = peer.server;
	const calls = [];
	const held = new Map();
	producer.on('connection', (socket) => {
		socket.on('message', (raw) => {
			const request = JSON.parse(raw.toString());
			calls.push(request);
			if (!request.requestId) return;
			const { requestId, payload } = request;

			const reply = (data) =>
				socket.send(JSON.stringify({ type: 'response', requestId, payload: { ok: true, data } }));

			const event = (type, payload) => socket.send(JSON.stringify({ type, payload }));

			if (request.type === 'terminal.currentDirectory') {
				reply('/actual');
			} else if (request.type === 'terminal.changeDirectory') {
				if (payload.path === '/local-close') {
					reply({ queued: true });
					return;
				}
				if (payload.path === '/disconnect') {
					socket.close(4000, 'controlled lost result');
					return;
				}
				event('terminal.directoryChangeQueued', {
					requestId,
					path: payload.path === '/wrong-queue' ? '/foreign' : payload.path,
					waitingForPrompt: true,
					privateField: 'discard',
				});
				if (payload.path === '/failed') {
					event('terminal.directoryChangeFailed', { requestId, message: 'replaced' });
					reply({ queued: true });
				} else if (payload.path === '/malformed-event') {
					event('terminal.directoryChanged', { requestId, path: 42 });
				} else {
					event('terminal.directoryChanged', { requestId: 'foreign-request', path: '/foreign' });
					event('terminal.directoryChanged', { requestId, path: '/resolved' });

					const deliver = () => {
						if (socket.readyState === WebSocket.OPEN) reply({ queued: payload.path !== '/bad-ack' });
					};

					if (payload.path === '/normal') held.set(payload.path, deliver);
					else deliver();
				}
			} else if (request.type === 'fixture.error') {
				socket.send(
					JSON.stringify({ type: 'response', requestId, payload: { ok: false, error: payload.code } }),
				);
			} else if (request.type === 'fixture.terminalError') {
				event('terminal.error', { message: payload.message });
				reply(null);
			} else reply(null);
		});
	});
	try {
		vi.stubGlobal('WebSocket', peer.WebSocket);
		{
			const { WorkspaceSocket } =
				await import('../../../../../packages/frontend/src/runtimes/workspace/protocol/workspaceSocket.ts');
			const { createTerminalChannel, createTerminalDirectoryPort } =
				await import('../../../../../packages/frontend/src/runtimes/workspace/adapters/terminal-adapters.ts');
			const sockets = [];
			const results = [];

			const expect = (condition, name) => {
				if (!condition) throw Error(name);
				results.push(name);
			};

			const make = async () => {
				const socket = new WorkspaceSocket();
				sockets.push(socket);
				await socket.open();
				return socket;
			};

			try {
				const socket = await make();
				const channel = createTerminalChannel(socket);
				let inputErrors = 0;
				const sentInputs = [];
				const stopInputSent = channel.onInputSent((data) => sentInputs.push(data));
				channel.onError(() => (inputErrors += 1));
				channel.sendInput('\ud800');
				channel.sendInput('中'.repeat(90000));
				expect(inputErrors === 2, 'malformed Unicode and oversized input rejected locally');
				channel.sendInput('accepted input');
				expect(
					JSON.stringify(sentInputs) === JSON.stringify(['accepted input']),
					'only accepted input reaches prediction observers',
				);
				stopInputSent();
				channel.sendInput('unsubscribed input');
				expect(sentInputs.length === 1, 'prediction observer is removed on unsubscribe');
				let invalidResize = false;
				try {
					channel.resize({ columns: 1, rows: 24 });
				} catch {
					invalidResize = true;
				}
				expect(invalidResize, 'invalid viewport rejected before sending');
				channel.resize({ columns: 100, rows: 30 });
				const directoryPort = createTerminalDirectoryPort(socket);
				expect(
					(await directoryPort.readCurrentDirectory()) === '/actual',
					'directory read uses strict response',
				);
				let queued;
				let completed = false;
				const changing = directoryPort
					.changeDirectory('/normal', { onQueued: (value) => (queued = value) })
					.then((value) => {
						completed = true;
						return value;
					});
				await vi.waitUntil(() => queued !== undefined, { timeout: 3000, interval: 10 });
				await socket.requestConnected('workspace.ping');
				expect(!completed, 'early completion event waits for request acknowledgement');
				held.get('/normal')();
				expect((await changing).path === '/resolved', 'resolved path accepted and foreign request ignored');
				expect(
					JSON.stringify(queued) === JSON.stringify({ path: '/normal', waitingForPrompt: true }),
					'queue mapped to independent safe application object',
				);
				for (const [path, code] of [
					['/bad-ack', 'protocol_error'],
					['/failed', 'replaced'],
					['/wrong-queue', 'protocol_error'],
				]) {
					const failure = await directoryPort.changeDirectory(path).catch((error) => error);
					expect(failure.code === code, path + ' rejects with finite failure');
				}
				const refused = await socket
					.requestConnected('fixture.error', { code: 'limit_exceeded' })
					.catch((error) => error);
				expect(
					refused.name === 'WorkspaceRequestFailure' && refused.code === 'limit_exceeded',
					'safe response uses named failure',
				);
				const disconnected = await make();
				const port = createTerminalDirectoryPort(disconnected);
				const failure = await port.changeDirectory('/disconnect').catch((error) => error);
				expect(
					failure.code === 'operation_unknown' && !disconnected.connected,
					'lost effect result remains unknown',
				);
				const notStarted = await port.changeDirectory('/not-connected').catch((error) => error);
				expect(notStarted.code === 'not_connected', 'detached write is rejected before dispatch');
				await port.readCurrentDirectory().catch(() => undefined);
				expect(!disconnected.connected, 'directory read never creates an unbound replacement');
				const localClose = await make();
				let closed = 0;
				localClose.onClose(() => (closed += 1));
				const waiting = createTerminalDirectoryPort(localClose)
					.changeDirectory('/local-close')
					.catch((error) => error);
				await localClose.requestConnected('workspace.ping');
				localClose.close();
				const localFailure = await waiting;
				localClose.close();
				expect(
					localFailure.code === 'operation_unknown' && closed === 1,
					'local close settles event wait after request ACK exactly once',
				);
				for (const [type, payload] of [
					['fixture.error', { code: 'private vendor message' }],
					['fixture.terminalError', { message: 'private vendor message' }],
				]) {
					const malformed = await make();
					const outcome = await malformed.requestConnected(type, payload).then(
						() => false,
						() => true,
					);
					expect(outcome && !malformed.connected, 'invalid finite contract closes transport: ' + type);
				}
				const malformed = await make();
				const invalid = await createTerminalDirectoryPort(malformed)
					.changeDirectory('/malformed-event')
					.catch((error) => error);
				expect(
					invalid.code === 'operation_unknown' && !malformed.connected,
					'malformed directory event cannot publish success',
				);
			} finally {
				for (const socket of sockets) socket.close();
			}
		}
		assert.deepEqual(
			calls.filter((call) => call.type === 'terminal.input').map((call) => call.payload.data),
			['accepted input', 'unsubscribed input'],
		);
		assert.deepEqual(
			calls.filter((call) => call.type === 'terminal.resize').map((call) => call.payload),
			[{ columns: 100, rows: 30 }],
		);
		assert.equal(calls.filter((call) => call.type === 'terminal.currentDirectory').length, 1);
		assert.equal(
			calls.filter((call) => call.type === 'terminal.changeDirectory' && call.payload.path === '/disconnect')
				.length,
			1,
		);
	} finally {
		await peer.close();
	}
});

// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import WebSocket from '../../../../../packages/backend/node_modules/ws/index.js';
import { openWorkspacePeer } from '../../../../support/protocols/workspace-peer.mjs';
import { encodeWorkspaceBinaryFrame } from '@nexus-terminal/shared/remote/workspace/workspace-binary';

afterEach(() => vi.unstubAllGlobals());

test('workspace session and registry correlate real wire generations and track original resources through close', async () => {
	const peer = await openWorkspacePeer();
	const producer = peer.server;
	const calls = [];
	const held = new Map();
	let attachments = 0;
	producer.on('connection', (socket) => {
		const attachment = ++attachments;
		let owner;
		let generation = 1;
		socket.on('message', (raw) => {
			const request = JSON.parse(raw.toString());
			calls.push({ attachment, owner, ...request });
			if (!request.requestId) return;

			const reply = (data) =>
				socket.send(
					JSON.stringify({ type: 'response', requestId: request.requestId, payload: { ok: true, data } }),
				);

			const output = (length) =>
				socket.send(encodeWorkspaceBinaryFrame('terminal', undefined, new Uint8Array(length).fill(65)));

			const receipt = (terminalOffset, replayedBytes) => ({
				workspaceId: request.payload.workspaceId,
				connectionId: request.payload.connectionId,
				connectionName: 'controlled',
				binaryProtocolVersion: 1,
				resumeToken: 'credential-' + generation,
				attachmentGeneration: generation,
				terminalOffset,
				replayedBytes,
				lastConnectedAt: 1700000000,
			});

			if (request.type === 'workspace.connect') {
				owner = request.payload.connectionId;

				const deliver = () => {
					if (socket.readyState !== WebSocket.OPEN) return;
					output(2);
					const result = receipt(100, 4);
					if (owner === 5) result.connectionId = 999;
					if (owner === 8) socket.send(JSON.stringify({ type: 'terminal.closed', payload: {} }));
					reply(result);
					output(2);
				};

				if (owner === 3) held.set(3, deliver);
				else if (owner === 6) socket.close(4000, 'lost creation receipt');
				else deliver();
			} else if (request.type === 'workspace.resume') {
				owner = request.payload.connectionId;
				generation = request.payload.attachmentGeneration + 1;
				output(5);
				const result = receipt(request.payload.terminalOffset + 5, 5);
				if (owner === 4) result.attachmentGeneration += 1;
				reply(result);
			} else if (request.type === 'workspace.resumeAck') {
				if (owner === 2) socket.close(4000, 'ACK receipt lost after simulated commit');
				else {
					output(2);
					reply(null);
				}
			} else if (request.type === 'workspace.close') {
				assert.ok(owner, 'close must use an attached transport');
				if (owner === 7 || owner === 27) socket.close(4000, 'close receipt lost');
				else if (owner === 21) held.set(21, () => socket.readyState === WebSocket.OPEN && reply(null));
				else reply(null);
			} else if (request.type === 'fixture.drop') {
				reply(null);
				socket.close(4000, 'controlled detach');
			} else if (request.type === 'filesystem.realpath') reply({ path: '/' });
			else if (request.type === 'filesystem.list') reply({ path: '/', entries: [] });
			else if (request.type === 'transfer.recover') reply([]);
			else reply(null);
		});
	});

	try {
		vi.stubGlobal('WebSocket', peer.WebSocket);
		vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor);
		setActivePinia(createPinia());
		const result = await (async () => {
			const { WorkspaceRuntimeSession } =
				await import('../../../../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
			const results = [];
			const sessions = [];

			const expect = (condition, name) => {
				if (!condition) throw Error(name);
				results.push(name);
			};

			const wait = (check) => vi.waitUntil(check, { timeout: 3000, interval: 10 });

			const make = (id) => {
				const session = new WorkspaceRuntimeSession(
					{ id, name: 'controlled', type: 'SSH', tagIds: [], jumpIds: [] },
					{ workspaceId: 'workspace-' + id },
				);
				session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
				sessions.push(session);
				return session;
			};

			const detach = async (session) => {
				await session.socket.requestConnected('fixture.drop');
				await wait(() => !session.socket.connected);
			};

			try {
				const normal = make(1);
				await normal.adapters.terminal.resize({ columns: 80, rows: 24 });
				const first = normal.connect({ columns: 80, rows: 24 });
				expect(normal.connect() === first, 'concurrent connects share one operation');
				const receipt = await first;
				await normal.socket.requestConnected('workspace.ping');
				expect(receipt.lastConnectedAt === 1700000000000, 'wire seconds mapped to application milliseconds');
				const originalAttachment = normal.socket.bindRequests();
				await detach(normal);
				await normal.connect();
				expect(normal.state.value === 'connected', 'resume ACK confirms ownership before activation');
				expect(
					await originalAttachment('fixture.stale').then(
						() => false,
						() => true,
					),
					'stale attachment cannot send through replacement',
				);
				await detach(normal);
				await normal.connect();
				expect(normal.state.value === 'connected', 'second resume includes output delivered during ACK');
				const close = normal.close();
				expect(normal.close() === close, 'concurrent closes share exact result');
				expect(
					(await close) === 'closed' && !normal.socket.connected,
					'close confirmed on original attachment',
				);
				const lost = make(2);
				await lost.connect();
				await detach(lost);
				expect(
					await lost.connect().then(
						() => false,
						() => true,
					),
					'missing ACK receipt rejects activation',
				);
				expect(lost.state.value === 'error', 'missing ACK receipt never reports connected');
				expect(
					await lost.connect().then(
						() => false,
						() => true,
					),
					'unknown ACK blocks manual replay',
				);
				expect((await lost.close()) === 'unknown', 'unknown ACK never reports release');
				const late = make(3);
				const lateConnect = late.connect().then(
					() => false,
					() => true,
				);
				await wait(() => held.has(3));
				const lateClose = late.close();
				held.get(3)();
				expect(await lateConnect, 'close during acquisition rejects late activation');
				expect(
					(await lateClose) === 'closed' && late.state.value === 'disconnected',
					'late receipt cleaned on original attachment',
				);
				const invalid = make(4);
				await invalid.connect();
				await detach(invalid);
				expect(
					await invalid.connect().then(
						() => false,
						() => true,
					),
					'wrong generation rejected before ACK',
				);
				const foreign = make(5);
				expect(
					await foreign.connect().then(
						() => false,
						() => true,
					),
					'foreign connection identity rejected',
				);
				expect((await foreign.close()) === 'unknown', 'foreign creation response does not invent ownership');
				const creation = make(6);
				expect(
					await creation.connect().then(
						() => false,
						() => true,
					),
					'lost creation receipt rejects activation',
				);
				expect(
					await creation.connect().then(
						() => false,
						() => true,
					),
					'lost creation receipt cannot replay create',
				);
				const ended = make(8);
				expect(
					await ended.connect().then(
						() => false,
						() => true,
					),
					'terminal end rejects late connection receipt',
				);
				expect(ended.state.value !== 'connected', 'terminal end cannot be overwritten by late activation');
				await ended.close();
				const closing = make(7);
				await closing.connect();
				expect((await closing.close()) === 'unknown', 'close response loss is unknown');
				return results;
			} finally {
				await Promise.all(sessions.map((session) => session.dispose()));
			}
		})();
		const lifecycle = await (async () => {
			const { workspaceRuntimeRegistry: registry } =
				await import('../../../../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
			const { authenticatedSessionLifecycle: lifecycle } =
				await import('../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts');
			const checks = [];

			const check = (condition, name) => {
				if (!condition) throw Error(name);
				checks.push(name);
			};

			const connection = (id) => ({ id, name: 'controlled registry', type: 'SSH', tagIds: [], jumpIds: [] });

			lifecycle.attach(1);
			try {
				const old = await registry.open(connection(21));
				const failure = new Error('controlled independent release failure');
				let remainingReleased = false;
				old.transferController.dispose = () => {
					throw failure;
				};
				const release = old.filesystemState.dispose;
				old.filesystemState.dispose = () => {
					remainingReleased = true;
					release();
				};
				registry.remove(old.id);
				const closed = old.dispose();
				check(old.dispose() === closed, 'dispose shares complete cleanup result');
				check(remainingReleased, 'independent cleanup continues after release failure');
				let finished = false;
				const retiring = registry.disposeAll().then(
					() => {
						throw Error('cleanup failure lost');
					},
					(cause) => {
						check(cause instanceof AggregateError, 'removed in-flight close participates in batch failure');
						check(cause.errors[0].errors.includes(failure), 'independent release cause preserved');
						finished = true;
					},
				);
				check(!finished, 'batch close waits for original attachment completion');
				const current = await registry.open(connection(22));
				await vi.waitUntil(() => held.has(21), { timeout: 3000, interval: 10 });
				held.get(21)();
				await retiring;
				check(
					registry.sessions.get(current.id) === current,
					'old cleanup does not remove newly opened runtime',
				);
				const documentPort = {
					load: async (path) => ({ path, content: 'private content', encoding: 'utf-8' }),

					save: async () => {},
				};
				await registry.sharedEditorSession.open('/shared', { scopeId: current.id, port: documentPort });
				registry.sharedEditorSession.update('private draft');
				await current.editorController.open('/local', { port: documentPort });
				await current.previewController.open('/private.png', {
					source: { read: async () => ({ bytes: new ArrayBuffer(1) }) },
				});
				lifecycle.logout();
				check(
					registry.sharedEditorSession.tabs.value.length === 0,
					'auth revocation clears shared private draft synchronously',
				);
				check(
					current.editorController.tabs.value.length === 0 &&
						current.previewController.tabs.value.length === 0,
					'runtime dispose clears private editor and preview',
				);
				check(registry.sessions.size === 0, 'auth revocation synchronously removes original runtimes');
				check((await current.dispose()) === 'closed', 'auth revocation closes original controlled attachment');
				lifecycle.attach(1);
				const resumed = registry
					.resume(
						{ id: 'never-dispatched-suspension', suspendedAt: new Date().toISOString() },
						connection(23),
					)
					.then(
						() => false,
						() => true,
					);
				await registry.disposeAll();
				check(await resumed, 'revoked pre-render resume cannot dispatch or restore tabs');
				check(registry.sessions.size === 0, 'late resume cannot repopulate registry');
				const hidden = await registry.open(connection(24));
				const replacement = registry
					.resumeReplacing(
						{ id: 'never-dispatched-hidden-replacement', suspendedAt: new Date().toISOString() },
						connection(24),
						hidden.id,
					)
					.then(
						() => false,
						() => true,
					);
				await registry.disposeAll();
				check(await replacement, 'revocation rejects hidden replacement delivery');
				check(
					(await hidden.dispose()) === 'closed',
					'batch close includes original hidden by replacement slot',
				);
				const original = await registry.open(connection(25));
				const cancelledReplacement = registry
					.resumeReplacing(
						{ id: 'never-dispatched-closed-replacement', suspendedAt: new Date().toISOString() },
						connection(25),
						original.id,
					)
					.then(
						() => false,
						() => true,
					);
				registry.remove(registry.activeId.value);
				check(await cancelledReplacement, 'closed replacement rejects before dispatch');
				check(registry.sessions.size === 0, 'closed replacement cannot resurrect hidden original tab');
				await registry.disposeAll();
				await registry.open(connection(27));
				check(
					await registry.disposeAll().then(
						() => false,
						() => true,
					),
					'unknown close cannot report batch success',
				);
				return checks;
			} finally {
				await registry.disposeAll();
				lifecycle.logout();
			}
		})();
		assert.ok(result.length >= 20);
		assert.ok(lifecycle.length >= 10);
		const creates = calls.filter((call) => call.type === 'workspace.connect');
		assert.equal(creates.filter((call) => call.payload.connectionId === 1).length, 1);
		assert.equal(creates.filter((call) => call.payload.connectionId === 6).length, 1);
		const normalResumes = calls.filter(
			(call) => call.type === 'workspace.resume' && call.payload.connectionId === 1,
		);
		const normalResume = normalResumes.at(-1);
		assert.equal(
			normalResumes[0].payload.terminalOffset,
			100,
			'pre/post JSON output counted without losing baseline',
		);
		assert.equal(
			normalResume.payload.terminalOffset,
			107,
			'output delivered during ACK advances next resume cursor',
		);
		assert.equal(calls.filter((call) => call.type === 'fixture.stale').length, 0, 'stale attachment sends nothing');
		const normalCalls = calls.filter((call) => call.attachment === normalResume.attachment);
		const ackIndex = normalCalls.findIndex((call) => call.type === 'workspace.resumeAck');
		assert.ok(ackIndex >= 0);
		assert.ok(
			normalCalls.findIndex((call) => call.type === 'terminal.resize') > ackIndex,
			'resize occurs after ownership ACK',
		);
		const normalClose = normalCalls.find((call) => call.type === 'workspace.close');
		assert.equal(normalClose.payload.attachmentGeneration, 3);
		assert.equal(calls.filter((call) => call.owner === 4 && call.type === 'workspace.resumeAck').length, 0);
		assert.equal(calls.filter((call) => call.owner === 2 && call.type === 'workspace.resumeAck').length, 1);
		assert.equal(
			calls.filter((call) => call.payload?.suspendedSessionId === 'never-dispatched-suspension').length,
			0,
		);
		assert.equal(
			calls.filter((call) => call.payload?.suspendedSessionId?.startsWith('never-dispatched-')).length,
			0,
		);
	} finally {
		await peer.close();
	}
});

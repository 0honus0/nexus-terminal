import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from '../../packages/backend/node_modules/ws/index.js';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { encodeWorkspaceBinaryFrame } from '../../packages/shared/dist/remote/workspace/workspace-binary.js';
import {
	readWorkspaceSuspendMark,
	readWorkspaceSuspendResume,
} from '../../packages/shared/dist/remote/suspend/workspace-codec.js';
import {
	readWorkspaceSuspendResumeResponse,
	readWorkspaceSuspendRevoked,
} from '../../packages/shared/dist/remote/suspend/workspace-result-codec.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-suspend-'));
const producer = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
const calls = [];
producer.on('connection', (socket) => {
	let owner;
	socket.on('message', (raw) => {
		const request = JSON.parse(raw.toString());
		if (request.type === 'suspend.resume') owner = Number(request.payload.suspendedSessionId.split('-').at(-1));
		if (request.type === 'workspace.connect') owner = request.payload.connectionId;
		calls.push({ owner, ...request });
		if (!request.requestId) return;

		const reply = (data) =>
			socket.readyState === WebSocket.OPEN &&
			socket.send(
				JSON.stringify({ type: 'response', requestId: request.requestId, payload: { ok: true, data } }),
			);

		const output = (length) =>
			socket.send(encodeWorkspaceBinaryFrame('terminal', undefined, new Uint8Array(length).fill(65)));

		if (request.type === 'suspend.resume') {
			const deliver = () => {
				if (socket.readyState !== WebSocket.OPEN) return;
				output(4);
				reply({
					workspaceId: request.payload.workspaceId,
					connectionId: owner,
					connectionName: 'controlled',
					binaryProtocolVersion: 1,
					resumeToken: 'credential-1',
					attachmentGeneration: 1,
					terminalOffset: owner === 4 ? 5 : 4,
					lastConnectedAt: 1700000000,
					resumedFrom: owner === 3 ? 'foreign-session' : request.payload.suspendedSessionId,
					historyAvailable: true,
					ownershipGeneration: 7,
					ownershipLeaseExpiresAt: Date.now() + 45_000,
				});
			};

			if (owner === 6) setTimeout(deliver, 100);
			else deliver();
		} else if (request.type === 'suspend.resumeAck') {
			if (owner === 2) socket.close(4000, 'ACK receipt lost');
			else
				setTimeout(() => {
					if (socket.readyState === WebSocket.OPEN) {
						output(2);
						reply(null);
					}
				}, 60);
		} else if (request.type === 'suspend.owner.renew') {
			reply({ generation: owner === 7 ? 8 : 7, leaseExpiresAt: Date.now() + 45_000 });
		} else if (request.type === 'suspend.history.previous') {
			socket.send(encodeWorkspaceBinaryFrame('response', request.requestId, new Uint8Array([72, 73])));
			socket.send(encodeWorkspaceBinaryFrame('response', request.requestId, new Uint8Array(), true));
			reply(owner === 9 ? { hasMore: true, privateField: 'rejected' } : { hasMore: false });
		} else if (request.type === 'suspend.history.reset') reply({ available: true });
		else if (request.type === 'fixture.revoke') {
			socket.send(
				JSON.stringify({
					type: 'suspend.revoked',
					payload: {
						suspendedSessionId: 'suspend-' + owner,
						generation: request.payload.generation,
						reason: 'takeover',
					},
				}),
			);
			reply(null);
		} else if (request.type === 'workspace.connect') {
			reply({
				workspaceId: request.payload.workspaceId,
				connectionId: owner,
				connectionName: 'controlled',
				binaryProtocolVersion: 1,
				resumeToken: 'credential-1',
				attachmentGeneration: 1,
				terminalOffset: 0,
				replayedBytes: 0,
			});
		} else if (request.type === 'suspend.commit' && owner === 10) socket.close(4000, 'commit receipt lost');
		else if (request.type === 'suspend.commit') reply({ suspendedSessionId: 'suspend-' + owner });
		else if (request.type === 'filesystem.realpath') reply({ path: '/' });
		else if (request.type === 'filesystem.list') reply({ path: '/', entries: [] });
		else if (request.type === 'transfer.recover') reply([]);
		else reply(null);
	});
});
let vite;
let browser;
try {
	await once(producer, 'listening');
	assert.throws(() => readWorkspaceSuspendMark({ terminalSnapshot: 'x', secret: true }));
	assert.throws(() => readWorkspaceSuspendMark({ terminalSnapshot: 'x'.repeat(4 * 1024 * 1024 + 1) }));
	assert.throws(() =>
		readWorkspaceSuspendResume({
			suspendedSessionId: 'suspend-1',
			workspaceId: 'workspace-1',
			viewport: { columns: 80, rows: 24, secret: 1 },
		}),
	);
	assert.throws(() =>
		readWorkspaceSuspendRevoked({ suspendedSessionId: 'suspend-1', generation: 1, reason: 'arbitrary diagnosis' }),
	);
	assert.throws(() =>
		readWorkspaceSuspendRevoked({
			suspendedSessionId: 'suspend-1',
			generation: 1,
			reason: 'takeover',
			message: 'secret',
		}),
	);
	assert.throws(() => readWorkspaceSuspendResumeResponse({}));
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
				name: 'isolated-workspace-suspend',

				resolveId(id) {
					if (id === '/__suspend_imports.js') return id;
				},

				load(id) {
					if (id === '/__suspend_imports.js') return 'export {createPinia,setActivePinia} from "pinia";';
				},

				configureServer(server) {
					server.middlewares.use('/__suspend_fixture', (_req, res) => {
						res.setHeader('Content-Type', 'text/html');
						res.end('<!doctype html><title>Suspend</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__suspend_fixture');
	const results = await page.evaluate(async () => {
		const { createPinia, setActivePinia } = await import('/__suspend_imports.js');
		setActivePinia(createPinia());
		const { WorkspaceRuntimeSession } = await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
		const results = [],
			sessions = [];

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			results.push(name);
		};

		const rejects = (task) =>
			task.then(
				() => false,
				() => true,
			);

		const wait = async (check) => {
			const end = performance.now() + 3000;
			while (!check()) {
				if (performance.now() > end) throw Error('condition timed out');
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		};

		const make = (id) => {
			const session = new WorkspaceRuntimeSession(
				{ id, name: 'controlled', type: 'SSH', tagIds: [], jumpIds: [] },
				{ workspaceId: 'workspace-' + id },
			);
			session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
			sessions.push(session);
			return session;
		};

		try {
			const normal = make(1);
			const task = normal.resume('suspend-1');
			expect(normal.resume('suspend-1') === task, 'same restore intent shares exact promise');
			expect(
				await rejects(normal.resume('suspend-1', undefined, { takeover: true })),
				'different restore intent rejected',
			);
			expect(await rejects(normal.connect()), 'ordinary connect cannot race suspended restore');
			normal.adapters.terminal.sendInput('before ACK');
			const result = await task;
			expect(result.lastConnectedAt === 1700000000000, 'restore maps wire seconds to application milliseconds');
			expect(!('replayedBytes' in result), 'restore does not fabricate normal replay bytes');
			expect(
				normal.state.value === 'connected' && !normal.recoveryRequired.value,
				'explicit ACK enables restored workspace',
			);
			expect(normal.terminalOffset === 6, 'live bytes during ACK remain in terminal offset');
			normal.adapters.terminal.sendInput('after ACK');
			const history = await normal.adapters.terminal.loadPreviousOutput(2);
			expect(
				history.data[0] === 72 && history.data.length === 2 && !history.hasMore,
				'history bytes and metadata decoded on original attachment',
			);
			expect(await normal.adapters.terminal.resetPreviousOutput(), 'history reset restores server-owned cursor');
			await wait(() => normal.ownershipGeneration === 7);
			await normal.socket.requestConnected('fixture.revoke', { generation: 6 });
			expect(normal.state.value === 'connected', 'stale ownership generation cannot revoke current attachment');
			await normal.socket.requestConnected('fixture.revoke', { generation: 7 }).catch(() => undefined);
			await wait(() => !normal.socket.connected);
			expect(
				normal.recoveryRequired.value && normal.state.value !== 'connected',
				'current revocation disables all capabilities',
			);
			const lost = make(2);
			expect(await rejects(lost.resume('suspend-2')), 'lost ACK receipt rejects restore');
			expect(
				lost.recoveryRequired.value && (await rejects(lost.resume('suspend-2'))),
				'unknown ACK blocks restore replay',
			);
			expect((await lost.close()) === 'unknown', 'unknown ACK does not invent confirmed release');
			for (const id of [3, 4]) {
				const invalid = make(id);
				expect(
					await rejects(invalid.resume('suspend-' + id)),
					'foreign identity or mismatched baseline ' + id + ' rejected before ACK',
				);
				expect(invalid.recoveryRequired.value, 'invalid prepared receipt retains unknown ' + id);
			}
			const late = make(6);
			const pending = rejects(late.resume('suspend-6'));
			await new Promise((resolve) => setTimeout(resolve, 20));
			const close = late.close();
			expect(await pending, 'close interrupts waiting restore');
			expect(
				(await close) === 'unknown' && late.state.value !== 'connected',
				'close retains unknown without late activation',
			);
			const lease = make(7);
			await lease.resume('suspend-7');
			await wait(() => lease.recoveryRequired.value);
			expect(
				!lease.socket.connected && lease.state.value === 'error',
				'renewal generation mismatch fences attachment and enables recovery alert',
			);
			const malformed = make(9);
			await malformed.resume('suspend-9');
			expect(
				await rejects(malformed.adapters.terminal.loadPreviousOutput(2)),
				'malformed history metadata rejects page',
			);
			expect(!malformed.adapters.terminal.hasPreviousOutput(), 'failed history delivery requires explicit reset');
			expect(
				await malformed.adapters.terminal.resetPreviousOutput(),
				'explicit reset remains available after failed page',
			);
			const mark = make(10);
			await mark.connect();
			expect(await rejects(mark.markForSuspend(async () => 'snapshot')), 'lost commit receipt rejects mark');
			expect(mark.recoveryRequired.value && !mark.socket.connected, 'unknown mark fences original workspace');
			const capacity = make(11);
			await capacity.connect();
			expect(
				await rejects(capacity.markForSuspend(async () => 'x'.repeat(4 * 1024 * 1024 + 1))),
				'oversize snapshot rejected before prepare',
			);
			expect(!capacity.recoveryRequired.value, 'unsent snapshot rejection keeps healthy workspace');
			const marked = await capacity.markForSuspend(async () => 'snapshot');
			expect(
				marked === 'suspend-11' && capacity.markedForSuspend.value,
				'confirmed commit exposes local mark result',
			);
			await capacity.unmarkSuspend();
			expect(!capacity.markedForSuspend.value, 'confirmed unmark clears local mark and lease');
			const inFlight = make(12);
			await inFlight.connect();
			let releaseSnapshot;
			let snapshotStarted = false;
			const marking = rejects(
				inFlight.markForSuspend(() => {
					snapshotStarted = true;
					return new Promise((resolve) => {
						releaseSnapshot = resolve;
					});
				}),
			);
			await wait(() => snapshotStarted);
			let closed = false;
			const closing = inFlight.close().then((result) => {
				closed = true;
				return result;
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(!closed, 'close tracks an in-flight snapshot until its real task settles');
			releaseSnapshot('late snapshot');
			expect(
				(await marking) && (await closing) === 'unknown',
				'late snapshot cannot publish a mark or claim confirmed release',
			);
			return results;
		} finally {
			await Promise.all(sessions.map((session) => session.dispose()));
		}
	});
	assert.equal(calls.filter((call) => call.type === 'suspend.resumeAck' && [3, 4].includes(call.owner)).length, 0);
	assert.equal(calls.filter((call) => call.type === 'suspend.resume' && call.owner === 2).length, 1);
	assert.equal(
		calls.filter((call) => call.type === 'suspend.unmark' && call.owner === 10).length,
		0,
		'lost commit must not trigger destructive compensation',
	);
	assert.equal(
		calls.filter((call) => call.type === 'terminal.input' && call.owner === 1).length,
		1,
		'input before ACK never dispatched',
	);
	assert.equal(calls.find((call) => call.type === 'terminal.input' && call.owner === 1).payload.data, 'after ACK');
	assert.equal(
		calls.filter((call) => call.type === 'suspend.prepare' && call.owner === 11).length,
		1,
		'invalid snapshot never dispatched prepare',
	);
	console.log('Suspend Shared codecs: 6 checks PASS');
	console.log(
		'Formal suspended Workspace Session / controlled WS: ' +
			results.length +
			' browser checks and 6 producer checks PASS',
	);
	console.log(results.join('\n'));
} finally {
	const cleanup = await Promise.allSettled(
		[
			() => browser?.close(),
			() => vite?.close(),
			() =>
				new Promise((resolve, reject) => {
					for (const socket of producer.clients) socket.terminate();
					producer.close((error) => (error ? reject(error) : resolve()));
				}),
		].map((task) => Promise.resolve().then(task)),
	);
	await rm(directory, { recursive: true, force: true });
	const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
	if (failures.length) throw new AggregateError(failures, 'Suspend fixture cleanup failed');
}

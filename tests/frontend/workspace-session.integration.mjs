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
	readWorkspaceConnectResponse,
	readWorkspaceEmptyResponse,
} from '../../packages/shared/dist/remote/workspace/workspace-codec.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const { WebSocketServer } = WebSocket;
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-session-'));
const producer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
const calls = [];
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

			if (owner === 3) setTimeout(deliver, 80);
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
			else if (owner === 21) setTimeout(() => socket.readyState === WebSocket.OPEN && reply(null), 100);
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
let vite;
let browser;
try {
	await once(producer, 'listening');
	const sample = {
		workspaceId: 'workspace-codec',
		connectionId: 1,
		connectionName: 'name',
		binaryProtocolVersion: 1,
		resumeToken: 'credential',
		attachmentGeneration: 1,
		terminalOffset: 10,
		replayedBytes: 4,
		lastConnectedAt: 1700000000,
	};
	assert.deepEqual(readWorkspaceConnectResponse({ ...sample, privateValue: 'hidden' }), sample);
	for (const patch of [
		{ replayedBytes: undefined },
		{ replayedBytes: 11 },
		{ terminalOffset: NaN },
		{ attachmentGeneration: 0 },
		{ lastConnectedAt: Number.MAX_SAFE_INTEGER },
		{ connectionName: 'x'.repeat(129) },
		{ binaryProtocolVersion: 2 },
	])
		assert.throws(() => readWorkspaceConnectResponse({ ...sample, ...patch }));
	assert.equal(readWorkspaceEmptyResponse(null), null);
	assert.throws(() => readWorkspaceEmptyResponse({}));
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
				name: 'isolated-workspace-session',

				resolveId(id) {
					if (id === '/__c2_session_imports.js') return id;
				},

				load(id) {
					if (id === '/__c2_session_imports.js') return 'export {createPinia,setActivePinia} from "pinia";';
				},

				configureServer(server) {
					server.middlewares.use('/api/v1/path-history', (_request, response) => {
						response.statusCode = 503;
						response.end();
					});
					server.middlewares.use('/__c2_session', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Workspace Session</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__c2_session');
	const result = await page.evaluate(async () => {
		const { createPinia, setActivePinia } = await import('/__c2_session_imports.js');
		setActivePinia(createPinia());
		const { WorkspaceRuntimeSession } = await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
		const results = [];
		const sessions = [];

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			results.push(name);
		};

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
			await new Promise((resolve) => setTimeout(resolve, 30));
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
			expect((await close) === 'closed' && !normal.socket.connected, 'close confirmed on original attachment');
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
			await new Promise((resolve) => setTimeout(resolve, 20));
			const lateClose = late.close();
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
	});
	const editorChecks = await page.evaluate(async () => {
		const { createFileEditorSession } = await import('/src/features/file-editor/public.ts');
		const { createFilePreviewSession } = await import('/src/features/file-preview/public.ts');
		const checks = [];

		const check = (condition, name) => {
			if (!condition) throw new Error(name);
			checks.push(name);
		};

		const rejected = (task) =>
			task.then(
				() => false,
				() => true,
			);

		const loaded = (content) => ({ path: '/file', content, encoding: 'utf-8' });

		const reads = [];
		const writes = [];
		let saveCalls = 0;
		const port = {
			load: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),

			save: () => {
				saveCalls += 1;
				return new Promise((resolve, reject) => writes.push({ resolve, reject }));
			},
		};
		const editor = createFileEditorSession(port);
		const opening = editor.open('/file', { scopeId: 'original', port });
		reads.shift().resolve(loaded('initial'));
		await opening;
		const original = editor.active.value;
		const first = rejected(editor.reload(original.id));
		const second = editor.changeEncoding(original.id, 'utf-16le');
		const firstRead = reads.shift();
		reads.shift().resolve({ path: '/file', content: 'latest read', encoding: 'utf-16le' });
		await second;
		firstRead.resolve(loaded('old read'));
		check(await first, 'superseded read rejects');
		check(original.content === 'latest read' && original.encoding === 'utf-16le', 'latest encoding read wins');
		const duringEdit = rejected(editor.reload(original.id));
		editor.update('new draft');
		reads.shift().resolve(loaded('remote old'));
		check(await duringEdit, 'read invalidated by editing rejects');
		check(original.content === 'new draft' && original.dirty, 'late read preserves new draft');
		const saving = editor.save();
		editor.update('typed while saving');
		writes.shift().resolve();
		await saving;
		check(
			original.originalContent === 'new draft' && original.dirty,
			'save confirms original snapshot and preserves subsequent typing',
		);
		const lateReload = rejected(editor.reload(original.id));
		editor.closeScope('original');
		reads.shift().resolve(loaded('late closed scope'));
		check(await lateReload, 'scope closure invalidates in-flight read');
		check(
			editor.tabs.value.length === 1 && original.content === 'typed while saving',
			'ordinary closure retains copyable draft',
		);
		check(await rejected(editor.save()), 'retained draft cannot write to disconnected scope');
		editor.reset();
		check(editor.tabs.value.length === 0 && editor.active.value === null, 'reset discards revoked draft');
		const staleCalls = saveCalls;
		check(await rejected(editor.save(original)), 'closed document cannot use default port');
		check(saveCalls === staleCalls, 'closed document dispatches no save');
		const oldOpen = rejected(editor.open('/old'));
		const oldRead = reads.shift();
		editor.reset();
		const newOpen = editor.open('/new');
		oldRead.resolve(loaded('revoked bytes'));
		check(await oldOpen, 'late open after reset rejects');
		check(editor.loading.value, 'old finally preserves new loading');
		reads.shift().resolve(loaded('new identity'));
		await newOpen;
		check(
			editor.tabs.value.length === 1 && editor.active.value.content === 'new identity' && !editor.loading.value,
			'only new document is published',
		);
		editor.update('in-flight save');
		const oldSave = rejected(editor.save());
		const oldDocument = editor.active.value;
		editor.reset();
		writes.shift().resolve();
		check(await oldSave, 'save completing after reset cannot confirm revoked document');
		check(
			editor.tabs.value.length === 0 && oldDocument.originalContent === 'new identity',
			'late save cannot republish or change original snapshot',
		);
		const nextOpen = editor.open('/next');
		reads.shift().resolve(loaded('next'));
		await nextOpen;
		const nextDocument = editor.active.value;
		const busySave = editor.save();
		check(!(await editor.closeAll()), 'close-all refuses saving document');
		writes.shift().resolve();
		await busySave;
		check(nextDocument.saveState === 'saved', 'refused close-all does not invalidate original save');
		const pendingOpen = rejected(editor.open('/pending'));
		const pendingRead = reads.shift();
		await editor.closeAll();
		pendingRead.resolve(loaded('closed'));
		check(await pendingOpen, 'close-all invalidates pending open');
		check(editor.tabs.value.length === 0 && !editor.loading.value, 'closed pending open cannot restore tabs');
		let previewReads = 0;
		let resolvePreview;
		let previewSignal;
		const preview = createFilePreviewSession({
			read: (_path, options) => {
				previewReads += 1;
				previewSignal = options.signal;
				return new Promise((resolve) => {
					resolvePreview = resolve;
				});
			},
		});
		const previewOpen = preview.open('/image.png');
		const oldPreview = preview.tabs.value[0];
		preview.clear();
		check(previewSignal.aborted, 'preview reset aborts original source');
		resolvePreview({ bytes: new ArrayBuffer(1) });
		await previewOpen;
		await preview.refresh(oldPreview);
		check(
			previewReads === 1 && preview.tabs.value.length === 0,
			'late preview and stale refresh do not restore or read old source',
		);
		return checks;
	});
	const lifecycle = await page.evaluate(async () => {
		const { workspaceRuntimeRegistry: registry } =
			await import('/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
		const { authenticatedSessionLifecycle: lifecycle } =
			await import('/src/shared/session/authenticatedSessionLifecycle.ts');
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
			await retiring;
			check(registry.sessions.get(current.id) === current, 'old cleanup does not remove newly opened runtime');
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
				current.editorController.tabs.value.length === 0 && current.previewController.tabs.value.length === 0,
				'runtime dispose clears private editor and preview',
			);
			check(registry.sessions.size === 0, 'auth revocation synchronously removes original runtimes');
			check((await current.dispose()) === 'closed', 'auth revocation closes original controlled attachment');
			lifecycle.attach(1);
			const resumed = registry
				.resume({ id: 'never-dispatched-suspension', suspendedAt: new Date().toISOString() }, connection(23))
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
			check((await hidden.dispose()) === 'closed', 'batch close includes original hidden by replacement slot');
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
	});
	const creates = calls.filter((call) => call.type === 'workspace.connect');
	assert.equal(creates.filter((call) => call.payload.connectionId === 1).length, 1);
	assert.equal(creates.filter((call) => call.payload.connectionId === 6).length, 1);
	const normalResumes = calls.filter((call) => call.type === 'workspace.resume' && call.payload.connectionId === 1);
	const normalResume = normalResumes.at(-1);
	assert.equal(normalResumes[0].payload.terminalOffset, 100, 'pre/post JSON output counted without losing baseline');
	assert.equal(normalResume.payload.terminalOffset, 107, 'output delivered during ACK advances next resume cursor');
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
	assert.equal(calls.filter((call) => call.payload?.suspendedSessionId === 'never-dispatched-suspension').length, 0);
	assert.equal(calls.filter((call) => call.payload?.suspendedSessionId?.startsWith('never-dispatched-')).length, 0);
	console.log('Workspace response codecs: 10 checks PASS');
	console.log(
		'Formal Workspace Session / controlled WS: ' + result.length + ' browser checks and 10 producer checks PASS',
	);
	console.log(result.join('\n'));
	console.log('Editor/preview lifecycle: ' + editorChecks.length + ' controlled browser checks PASS');
	console.log(editorChecks.join('\n'));
	console.log('Registry lifecycle: ' + lifecycle.length + ' controlled browser checks PASS');
	console.log(lifecycle.join('\n'));
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
	if (failures.length) throw new AggregateError(failures, 'Workspace session fixture cleanup failed');
}

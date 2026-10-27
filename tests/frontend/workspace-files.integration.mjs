import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from '../../packages/backend/node_modules/ws/index.js';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import * as files from '../../packages/shared/dist/remote/files/workspace-codec.js';
import { encodeWorkspaceBinaryFrame } from '../../packages/shared/dist/remote/workspace/workspace-binary.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-files-'));
const producer = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
const calls = [];
const metadata = {
	size: 4,
	uid: 1,
	gid: 2,
	mode: 0o100644,
	accessedAt: 1700000000000,
	modifiedAt: 1700000000000,
	isFile: true,
	isDirectory: false,
	isSymbolicLink: false,
};
const entry = { name: 'a.txt', path: '/root/a.txt', metadata };
producer.on('connection', (socket) => {
	let readySent = false;
	socket.on('message', (raw) => {
		const { type, requestId, payload } = JSON.parse(raw.toString());
		calls.push({ type, requestId, payload, readySent });
		if (!requestId) return;

		const reply = (data) =>
			socket.send(JSON.stringify({ type: 'response', requestId, payload: { ok: true, data } }));

		if (type === 'fixture.filesReady') {
			readySent = true;
			socket.send(JSON.stringify({ type: 'filesystem.ready', payload: {} }));
			reply(null);
		} else if (type === 'fixture.filesError') {
			socket.send(JSON.stringify({ type: 'filesystem.error', payload: { message: payload.code } }));
			reply(null);
		} else if (type === 'filesystem.list') {
			if (payload.path === '/foreign') reply({ path: '/different', entries: [] });
			else if (payload.path === '/duplicate')
				reply({
					path: payload.path,
					entries: [
						{ ...entry, path: '/duplicate/a.txt' },
						{ ...entry, path: '/duplicate/a.txt' },
					],
				});
			else if (payload.path === '/escape') reply({ path: payload.path, entries: [entry] });
			else
				reply({
					path: '/root',
					entries: [{ ...entry, secret: 'discard', metadata: { ...metadata, password: 'discard' } }],
				});
		} else if (type === 'filesystem.search') {
			reply({
				entries: [{ ...entry, relativePath: payload.query === 'bad' ? 'foreign' : 'a.txt' }],
				truncated: false,
			});
		} else if (type === 'filesystem.stat') {
			if (payload.path === '/wait') return;
			reply({ ...entry, path: payload.path });
		} else if (type === 'filesystem.realpath') {
			reply({ requestedPath: payload.path, absolutePath: '/elsewhere/target', targetType: 'file' });
		} else if (type === 'filesystem.readBinary') {
			if (payload.path === '/wait') return;
			socket.send(encodeWorkspaceBinaryFrame('response', requestId, Uint8Array.of(0, 1, 2, 255)));
			socket.send(encodeWorkspaceBinaryFrame('response', requestId, new Uint8Array(), true));
			reply({ path: payload.path === '/foreign' ? '/other' : payload.path });
		} else if (payload.path === '/lost') {
			socket.close(4000, 'controlled lost result');
		} else if (payload.path === '/bad-result') {
			reply({ success: true });
		} else if (payload.path === '/denied') {
			socket.send(JSON.stringify({ type: 'response', requestId, payload: { ok: false, error: 'forbidden' } }));
		} else reply(null);
	});
});
let vite;
let browser;
try {
	await once(producer, 'listening');
	assert.deepEqual(files.readWorkspaceFileEntry({ ...entry, secret: 'discard' }), entry);
	assert.deepEqual(files.readWorkspaceFileEntry({ ...entry, metadata: { ...metadata, secret: 'discard' } }), entry);
	assert.equal(
		files.readWorkspaceFileListResponse({ path: '/', entries: Array(20001).fill(entry) }).entries.length,
		20001,
	);
	let rejected = 0;
	for (const [decode, input] of [
		[files.readWorkspaceFileMetadata, { ...metadata, size: -1 }],
		[files.readWorkspaceFileMetadata, { ...metadata, modifiedAt: '1700000000000' }],
		[files.readWorkspaceFileMetadata, { ...metadata, isDirectory: true }],
		[files.readWorkspaceFileMetadata, { ...metadata, mode: 2 ** 32 }],
		[files.readWorkspaceFileEntry, { ...entry, name: 'bad/name' }],
		[files.readWorkspaceFileEntry, { ...entry, path: '/bad\ud800' }],
		[files.readWorkspaceFileSearchResponse, { entries: [], truncated: 1 }],
		[
			files.readWorkspaceFileSearchResponse,
			{ entries: Array(501).fill({ ...entry, relativePath: 'a.txt' }), truncated: true },
		],
		[files.readWorkspaceFileMutationResponse, { ok: true }],
		[files.readWorkspaceFileReadBinaryResponse, { path: 1 }],
		[
			files.readWorkspaceFileRealpathResponse,
			{ requestedPath: '/', absolutePath: '/target', targetType: 'symlink' },
		],
		[files.readWorkspaceFileError, { message: 'private vendor failure' }],
		[files.readWorkspaceFileReady, null],
	]) {
		assert.throws(() => decode(input));
		rejected += 1;
	}
	assert.equal(files.readWorkspaceFileCancelReadResponse(false), false);
	assert.deepEqual(files.readWorkspaceFileError({ message: 'operation_unknown' }), { message: 'operation_unknown' });
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
				name: 'workspace-files-fixture',

				configureServer(server) {
					server.middlewares.use('/__c2_files', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Files</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__c2_files');
	const results = await page.evaluate(async () => {
		const { WorkspaceSocket } = await import('/src/runtimes/workspace/protocol/workspaceSocket.ts');
		const { WorkspaceDispatchFailure } = await import('/src/runtimes/workspace/model/workspace-error-types.ts');
		const { createFilesystemChannel, createFilePreviewSource } =
			await import('/src/runtimes/workspace/adapters/filesystem-adapters.ts');
		const sockets = [];
		const results = [];

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			results.push(name);
		};

		const fails = async (promise, code, name) => {
			await promise.then(
				() => {
					throw Error(name + ' accepted');
				},
				(error) => expect(error.code === code, name),
			);
		};

		try {
			const socket = new WorkspaceSocket();
			sockets.push(socket);
			const fs = createFilesystemChannel(socket);
			await socket.open();
			const listingPromise = fs.listDirectory('/root');
			await socket.requestConnected('fixture.filesReady', {});
			const listing = await listingPromise;
			expect(
				!('secret' in listing.entries[0]) && !('password' in listing.entries[0].metadata),
				'nested wire fields projected before application exposure',
			);
			await fails(fs.listDirectory('/foreign'), 'protocol_error', 'wrong response directory rejected');
			await fails(fs.listDirectory('/duplicate'), 'protocol_error', 'duplicate listing paths rejected');
			await fails(fs.listDirectory('/escape'), 'protocol_error', 'foreign child rejected');
			expect(
				(await fs.search('/root', 'valid')).entries[0].relativePath === 'a.txt',
				'search maps independent result',
			);
			await fails(fs.search('/root', 'bad'), 'protocol_error', 'search relative identity checked');
			expect(
				(await fs.realpath('/symlink')).path === '/elsewhere/target',
				'resolved symlink may point outside lexical parent',
			);
			await fails(
				fs.readBinary('/foreign', 100),
				'protocol_error',
				'binary metadata path checked after complete final',
			);
			const binary = await fs.readBinary('/binary', 100);
			expect(binary.bytes.join(',') === '0,1,2,255', 'binary data is not coerced to text');
			const controller = new AbortController();
			const read = fs.readBinary('/wait', 100, controller.signal);
			await new Promise((resolve) => setTimeout(resolve, 30));
			controller.abort();
			await read.then(
				() => {
					throw Error('cancel accepted');
				},
				(error) => expect(error.name === 'AbortError', 'active binary read cancels original request'),
			);
			const previewController = new AbortController();
			const preview = createFilePreviewSource(fs).read('/wait', { signal: previewController.signal });
			await new Promise((resolve) => setTimeout(resolve, 30));
			previewController.abort();
			await preview.then(
				() => {
					throw Error('preview cancel accepted');
				},
				(error) => expect(error.name === 'AbortError', 'preview cancellation also interrupts metadata wait'),
			);
			await fs.writeText('/ok', 'text', 'utf-8');
			await fs.createDirectory('/created');
			await fs.createFile('/new');
			await fs.rename('/new', '/renamed');
			await fs.chmod('/renamed', 0o600);
			await fs.remove(['/renamed']);
			expect(true, 'all mutation success acknowledgments require null');
			await fails(fs.writeText('/denied', 'text'), 'forbidden', 'explicit safe rejection preserved');
			await fs.writeText('/bad-result', 'text').then(
				() => {
					throw Error('bad result accepted');
				},
				(error) =>
					expect(
						error.code === 'operation_unknown' && error.outcomeUnknown,
						'malformed write acknowledgment preserves unknown effect',
					),
			);
			await fails(
				fs.writeText('/huge', 'x'.repeat(1024 * 1024)),
				'limit_exceeded',
				'complete request capacity checked before send',
			);
			await fails(
				createFilesystemChannel(socket, () => false).listDirectory('/root'),
				'not_connected',
				'ownership ACK gate blocks premature Files use',
			);
			const originalBind = socket.bindRequests.bind(socket);
			socket.bindRequests = () => () => Promise.reject(new WorkspaceDispatchFailure('limit_exceeded'));
			try {
				await fs.createFile('/local-capacity').then(
					() => {
						throw Error('local capacity accepted');
					},
					(error) =>
						expect(
							error.code === 'limit_exceeded' && !error.outcomeUnknown,
							'confirmed local send rejection is not an unknown write',
						),
				);
			} finally {
				socket.bindRequests = originalBind;
			}
			await fs.createFile('/lost').then(
				() => {
					throw Error('lost accepted');
				},
				(error) =>
					expect(
						error.code === 'operation_unknown' && error.outcomeUnknown,
						'lost mutation acknowledgment is unknown',
					),
			);
			await fails(
				fs.createFile('/after-close'),
				'not_connected',
				'disconnected mutation never opens replacement socket',
			);

			const failed = new WorkspaceSocket();
			sockets.push(failed);
			const failedFs = createFilesystemChannel(failed);
			await failed.open();
			const pendingRead = fails(
				failedFs.stat('/root/a.txt'),
				'remote_unavailable',
				'SFTP failure rejects readiness wait before any file command',
			);
			await failed.requestConnected('fixture.filesError', { code: 'remote_unavailable' });
			await pendingRead;
			await fails(
				failedFs.createFile('/never-dispatched'),
				'remote_unavailable',
				'failed file capability does not dispatch writes',
			);
			failedFs.dispose();
			const delayed = new WorkspaceSocket();
			sockets.push(delayed);
			const delayedFs = createFilesystemChannel(delayed);
			await delayed.open();
			const waiting = delayedFs.createFile('/never-dispatched');
			const waitingResult = fails(
				waiting,
				'not_connected',
				'local close releases SFTP readiness wait before dispatch',
			);
			delayed.close('controlled readiness detach');
			await waitingResult;
			delayedFs.dispose();
			const stopped = new WorkspaceSocket();
			sockets.push(stopped);
			const stoppedFs = createFilesystemChannel(stopped);
			await stopped.open();
			const stoppedResult = fails(
				stoppedFs.listDirectory('/root'),
				'not_connected',
				'dispose releases original Files readiness listeners and waits',
			);
			stoppedFs.dispose();
			await stoppedResult;
			const abortedSocket = new WorkspaceSocket();
			sockets.push(abortedSocket);
			const abortedFs = createFilesystemChannel(abortedSocket);
			await abortedSocket.open();
			const signal = new AbortController();
			const abortedRead = abortedFs.stat('/root/a.txt', signal.signal);
			signal.abort();
			await abortedRead.then(
				() => {
					throw Error('readiness abort accepted');
				},
				(error) => expect(error.name === 'AbortError', 'abort releases readiness wait without sending stat'),
			);
			abortedFs.dispose();
			const full = new WorkspaceSocket();
			sockets.push(full);
			const fullFs = createFilesystemChannel(full);
			await full.open();
			const pending = Array.from({ length: 65 }, () =>
				fullFs.createFile('/capacity-wait').then(
					() => 'sent',
					(error) => error.code,
				),
			);
			full.close('controlled capacity detach');
			const codes = await Promise.all(pending);
			expect(
				codes.filter((code) => code === 'limit_exceeded').length === 1 &&
					codes.filter((code) => code === 'not_connected').length === 64,
				'readiness admission stays bounded and all waits settle',
			);
			fullFs.dispose();
			return results;
		} finally {
			for (const socket of sockets) socket.close('Files test complete');
		}
	});
	assert.ok(
		calls.filter((call) => call.type.startsWith('filesystem.')).every((call) => call.readySent),
		'no command dispatched before Files readiness',
	);
	const cancelledRead = calls.find((call) => call.type === 'filesystem.readBinary' && call.payload.path === '/wait');
	assert.ok(
		calls.some(
			(call) => call.type === 'filesystem.cancelRead' && call.payload.requestId === cancelledRead.requestId,
		),
	);
	assert.equal(calls.filter((call) => call.payload.path === '/lost').length, 1);
	assert.ok(
		!calls.some((call) =>
			['/huge', '/after-close', '/never-dispatched', '/capacity-wait'].includes(call.payload.path),
		),
	);
	console.log(
		'Files Shared codecs: ' +
			(rejected + 4) +
			'; browser boundaries: ' +
			results.length +
			'; dispatch assertions: 4 PASS',
	);
	console.log(results.join('\n'));
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() =>
			new Promise((resolve, reject) => {
				producer.close((error) => (error ? reject(error) : resolve()));
				for (const socket of producer.clients) socket.terminate();
			}),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'Files test cleanup failed');
}

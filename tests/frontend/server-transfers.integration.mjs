import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-server-transfers-'));
let vite;
let browser;
try {
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0 },
		plugins: [
			{
				name: 'server-transfer-fixture',

				resolveId(id) {
					if (id === '/__transfer_imports.js') return id;
				},

				load(id) {
					if (id === '/__transfer_imports.js')
						return 'export {createPinia,setActivePinia} from "pinia"; export {readServerTransferSnapshot,readServerTransferInput} from "@nexus-terminal/shared/remote/transfers/server-codec";';
				},

				configureServer(server) {
					server.middlewares.use('/__server_transfer', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Server transfers</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__server_transfer');
	const checks = await page.evaluate(async () => {
		const { createPinia, setActivePinia } = await import('/__transfer_imports.js');
		setActivePinia(createPinia());
		const { serverTransfersApi } = await import('/src/features/transfers/api/server-transfers-api.ts');
		const { useServerTransfersStore } = await import('/src/features/transfers/store/serverTransfers.store.ts');
		const { ServerTransferRequestFailure } = await import('/src/features/transfers/model/server-transfer-types.ts');
		const { readServerTransferSnapshot, readServerTransferInput } = await import('/__transfer_imports.js');
		const results = [];

		const expect = (value, label) => {
			if (!value) throw new Error(label);
			results.push(label);
		};

		const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

		const command = {
			sourceConnectionId: 1,
			connectionIds: [2],
			sourceItems: [{ name: 'a', path: '/source/a', type: 'file' }],
			remoteTargetPath: '/target',
			transferMethod: 'auto',
		};
		expect(
			readServerTransferInput({ ...command, remoteTargetPath: '/' }).remoteTargetPath === '/',
			'root is a valid destination directory',
		);
		expect(
			readServerTransferInput({ ...command, remoteTargetPath: '/ folder ' }).remoteTargetPath === '/ folder ',
			'selected directory whitespace is preserved',
		);

		const make = (n, status = 'queued') => ({
			taskId: uuid(n),
			status,
			createdAt: 1000,
			updatedAt: 1000,
			overallProgress: status === 'completed' ? 100 : 0,
			payload: structuredClone(command),
			subTasks: [
				{
					subTaskId: uuid(n + 100),
					connectionId: 2,
					sourceItemIndex: 0,
					status: status === 'in-progress' || status === 'cancelling' ? 'transferring' : status,
					progress: status === 'completed' ? 100 : 0,
					error: status === 'unknown' ? 'operation_unknown' : status === 'failed' ? 'transfer_failed' : null,
					transferMethodUsed: status === 'queued' ? null : 'scp',
				},
			],
		});

		const json = (body, status = 200) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

		const calls = [];

		let respond = () => json(make(1), 202);

		const original = window.fetch;
		window.fetch = async (url, options) => {
			calls.push({ url, method: options.method, signal: options.signal });
			return respond(url, options);
		};

		async function rejects(work, code, label) {
			let error;
			try {
				await work();
			} catch (cause) {
				error = cause;
			}
			expect(error instanceof ServerTransferRequestFailure && error.code === code, label);
		}

		const store = useServerTransfersStore();
		try {
			const task = await serverTransfersApi.send(command);
			expect(
				task.status === 'queued' && task.subTasks[0].sourceItemName === 'a' && task.createdAt === 1000,
				'Shared wire projects to application identity, source name and milliseconds',
			);
			expect(calls.length === 1 && calls[0].url === '/api/v1/transfers/send', 'send has one real HTTP dispatch');
			let count = calls.length;
			await rejects(
				() => serverTransfersApi.send({ ...command, remoteTargetPath: '../bad' }),
				'invalid_input',
				'invalid paths fail before dispatch',
			);
			expect(calls.length === count, 'invalid inputs create no network call');
			respond = () => json({ ...make(1), payload: { ...command, remoteTargetPath: '/unrelated' } }, 202);
			await rejects(
				() => serverTransfersApi.send(command),
				'protocol_failure',
				'acceptance must match complete original request',
			);
			respond = () => json(make(2));
			await rejects(
				() => serverTransfersApi.details(uuid(1)),
				'protocol_failure',
				'detail identity mismatch rejected',
			);
			respond = () => json({ taskId: uuid(2), accepted: true });
			await rejects(
				() => serverTransfersApi.cancel(uuid(1)),
				'protocol_failure',
				'cancel identity mismatch rejected',
			);
			respond = () => json({ taskId: uuid(1), accepted: false });
			await rejects(
				() => serverTransfersApi.cancel(uuid(1)),
				'protocol_failure',
				'false cancellation acknowledgement rejected',
			);
			respond = () => json({ code: 'private tool diagnostic' }, 422);
			await rejects(
				() => serverTransfersApi.send(command),
				'protocol_failure',
				'raw diagnostics cannot become application error codes',
			);
			respond = () => json({ code: 'host_key_untrusted' }, 422);
			await rejects(() => serverTransfersApi.send(command), 'host_key_untrusted', 'finite refusal preserved');
			respond = () => json({ code: 'host_key_untrusted' }, 503);
			await rejects(
				() => serverTransfersApi.send(command),
				'protocol_failure',
				'failure code and HTTP status must agree',
			);
			respond = () => new Response(null, { status: 204 });
			await serverTransfersApi.remove(uuid(1));
			expect(true, '204 removal has no fake JSON requirement');
			respond = (url) =>
				url.includes('?after=')
					? json({ items: [make(9)], nextCursor: null })
					: json({ items: Array.from({ length: 8 }, (_, index) => make(index + 1)), nextCursor: uuid(8) });
			expect(
				(await serverTransfersApi.list()).length === 9,
				'pagination collects both pages without dropping tasks',
			);
			respond = () => json({ items: [make(2), make(2)], nextCursor: null });
			await rejects(() => serverTransfersApi.list(), 'protocol_failure', 'duplicate task identity rejected');
			respond = () => json({ ...make(1), subTasks: [{ ...make(1).subTasks[0], sourceItemIndex: 2 }] });
			await rejects(
				() => serverTransfersApi.details(uuid(1)),
				'protocol_failure',
				'subtask source index must match original input',
			);
			let invalid = false;
			try {
				readServerTransferSnapshot({ ...make(1), status: 'completed' });
			} catch {
				invalid = true;
			}
			expect(invalid, 'parent cannot complete while child remains queued');
			store.reset();
			let releaseRead;
			respond = (url, options) =>
				options.method === 'POST'
					? json(make(2), 202)
					: new Promise((resolve) => {
							releaseRead = resolve;
						});
			const oldRead = store.load();
			await new Promise((resolve) => setTimeout(resolve, 0));
			await store.send(command);
			releaseRead(json({ items: [make(1)], nextCursor: null }));
			await oldRead;
			expect(
				store.items.length === 1 && store.items[0].taskId === uuid(2),
				'late poll cannot overwrite accepted task',
			);
			store.reset();
			let releaseSend;
			respond = () =>
				new Promise((resolve) => {
					releaseSend = resolve;
				});
			const sending = store.send(command);
			store.reset();
			releaseSend(json(make(3), 202));
			await sending;
			expect(store.items.length === 0, 'late send cannot restore prior authenticated session');
			respond = () => {
				throw new Error('private connection details');
			};
			await store.send(command).catch(() => {});
			expect(
				store.sendBlocked && store.error === 'serverTransferErrors.operation_unknown',
				'lost creation response preserves unknown and blocks repeated dispatch',
			);
			count = calls.length;
			await store.send(command).catch(() => {});
			expect(calls.length === count, 'unknown creation is never automatically resent');
			respond = () => json({ items: [make(4, 'in-progress')], nextCursor: null });
			await store.load();
			expect(
				store.items.length === 1 && store.sendBlocked,
				'read-only recovery keeps tasks visible without proving lost intent absent',
			);
			store.reset();
			const concurrentResponses = [];
			respond = () => new Promise((resolve) => concurrentResponses.push(resolve));
			const unknownSend = store.send(command).catch(() => {});
			const rejectedSend = store.send(command).catch(() => {});
			concurrentResponses[0](new Response('invalid response', { status: 202 }));
			await unknownSend;
			concurrentResponses[1](json({ code: 'host_key_untrusted' }, 422));
			await rejectedSend;
			expect(
				store.sendBlocked && store.error === 'serverTransferErrors.operation_unknown',
				'a different intent refusal cannot clear an earlier unknown dispatch',
			);
			store.reset();
			respond = () => json({ items: [make(5, 'in-progress')], nextCursor: null });
			await store.load();
			let releaseCancel;
			respond = (_url, options) =>
				options.method === 'POST'
					? new Promise((resolve) => {
							releaseCancel = resolve;
						})
					: json({ items: [make(5, 'cancelling')], nextCursor: null });
			const first = store.cancel(uuid(5));
			const second = store.cancel(uuid(5));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(
				calls.filter((call) => call.url === '/api/v1/transfers/cancel/' + uuid(5)).length === 1,
				'concurrent cancellation shares the actual request',
			);
			releaseCancel(json({ taskId: uuid(5), accepted: true }));
			await Promise.all([first, second]);
			expect(store.items[0].status === 'cancelling', 'cancel admission never fabricates terminal cancelled');
			return results;
		} finally {
			store.reset();
			window.fetch = original;
		}
	});
	assert.ok(checks.length >= 20);
	console.log('Server transfers: ' + checks.length + ' controlled Chromium checks PASS');
	console.log(checks.join('\n'));
} finally {
	const outcomes = await Promise.allSettled([
		Promise.resolve().then(() => browser?.close()),
		Promise.resolve().then(() => vite?.close()),
	]);
	await rm(directory, { recursive: true, force: true });
	const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
	if (failures.length) throw new AggregateError(failures, 'Frontend transfer cleanup failed');
}

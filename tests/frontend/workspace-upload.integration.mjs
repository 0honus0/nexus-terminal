import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import {
	readWorkspaceUploadPrepared,
	readWorkspaceTaskStarted,
	readWorkspaceTaskStopped,
	readWorkspaceUploadEvent,
} from '../../packages/shared/dist/remote/transfers/workspace-codec.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-upload-'));
let vite;
let browser;
try {
	assert.deepEqual(readWorkspaceUploadPrepared({ preparedDirectories: 20_002 }), { preparedDirectories: 20_002 });
	let codecChecks = 1;
	for (const [decode, invalid] of [
		[readWorkspaceUploadPrepared, { preparedDirectories: 0 }],
		[readWorkspaceTaskStarted, { started: 1 }],
		[readWorkspaceTaskStopped, { stopped: true }],
		[readWorkspaceUploadEvent, { type: 'failed', uploadId: 'u', message: 'technical secret' }],
		[
			readWorkspaceUploadEvent,
			{ type: 'progress', uploadId: 'u', chunkIndex: 0, bytesWritten: 2, totalSize: 1, progress: 100 },
		],
		[
			readWorkspaceUploadEvent,
			{ type: 'progress', uploadId: 'u', chunkIndex: 0, bytesWritten: 1, totalSize: 2, progress: 99 },
		],
		[readWorkspaceUploadEvent, { type: 'conflict', uploadId: 'u', destinationPath: '/one', filename: 'two' }],
		[readWorkspaceUploadEvent, { type: 'ready', uploadId: '' }],
	]) {
		assert.throws(() => decode(invalid));
		codecChecks++;
	}
	assert.deepEqual(readWorkspaceUploadPrepared({ preparedDirectories: 1, secret: true }), { preparedDirectories: 1 });
	assert.deepEqual(readWorkspaceTaskStarted({ started: true, secret: true }), { started: true });
	assert.equal(readWorkspaceTaskStopped(false), false);
	assert.deepEqual(readWorkspaceUploadEvent({ type: 'ready', uploadId: 'u', secret: true }), {
		type: 'ready',
		uploadId: 'u',
	});
	codecChecks += 4;
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0 },
		plugins: [
			{
				name: 'workspace-upload-page',

				configureServer(server) {
					server.middlewares.use('/__c2_upload', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Upload boundaries</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__c2_upload');
	const checks = await page.evaluate(async () => {
		const { createWorkspaceUploadAdapter } = await import('/src/runtimes/workspace/adapters/upload-adapters.ts');
		const { createTransferController } = await import('/src/features/transfers/state/transferController.ts');
		const NativeWebSocket = window.WebSocket;
		const checks = [];
		const owners = [];
		let mode = 'open';
		let streams = [];

		let sendHook = () => {};

		class ControlledSocket extends EventTarget {
			static CONNECTING = 0;
			static OPEN = 1;
			static CLOSING = 2;
			static CLOSED = 3;
			readyState = 0;
			bufferedAmount = 0;
			sentBytes = 0;

			constructor(url) {
				super();
				this.url = url;
				streams.push(this);
				queueMicrotask(() => {
					if (this.readyState !== 0) return;
					if (mode === 'close') return this.close(1006);
					this.readyState = 1;
					this.dispatchEvent(new Event('open'));
				});
			}

			send(bytes) {
				this.sentBytes += bytes.byteLength;
				sendHook(this, bytes);
			}

			close(code = 1000) {
				this.readyState = 3;
				this.dispatchEvent(new CloseEvent('close', { code }));
			}
		}
		window.WebSocket = ControlledSocket;
		Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true });

		const expect = (condition, label) => {
			if (!condition) throw Error(label);
			checks.push(label);
		};

		const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

		const until = async (condition) => {
			const deadline = Date.now() + 3000;
			while (!condition()) {
				if (Date.now() > deadline) throw Error('Controlled upload wait timed out');
				await tick();
			}
		};

		const completed = (id, path, size) => ({
			type: 'completed',
			uploadId: id,
			destinationPath: path,
			item: {
				name: path.split('/').at(-1),
				path,
				metadata: {
					size,
					uid: 0,
					gid: 0,
					mode: 0o100644,
					accessedAt: 0,
					modifiedAt: 0,
					isFile: true,
					isDirectory: false,
					isSymbolicLink: false,
				},
			},
		});

		const command = (id, size = 1) => ({
			id,
			file: new File([new Uint8Array(size)], 'file.txt'),
			destination: { scopeId: 'workspace-original', path: '/root' },
		});

		const fixture = () => {
			let handler;

			let requestHook = async (type) =>
				type === 'upload.start'
					? { started: true }
					: type === 'upload.prepare'
						? { preparedDirectories: 1 }
						: true;

			const calls = [];
			const events = [];
			const socket = {
				connected: true,

				on(_type, listener) {
					handler = listener;
					return () => {
						handler = undefined;
					};
				},

				bindRequests() {
					return async (type, payload, id, signal) => {
						calls.push({ type, payload, id, signal });
						return requestHook(type, payload, signal);
					};
				},
			};
			const owner = createWorkspaceUploadAdapter(
				socket,
				'workspace-original',
				() => socket.connected,
				(event) => events.push(event),
			);
			owners.push(owner);
			return {
				owner,
				socket,
				calls,
				events,

				publish: (event) => handler?.(event),

				hook: (callback) => {
					requestHook = callback;
				},
			};
		};

		try {
			const batches = fixture();
			for (let index = 0; index < 65; index++) {
				await batches.owner.prepare({
					id: 'batch-' + index,
					destination: command('x').destination,
					directories: [],
				});
			}
			expect(batches.calls.length === 65, '65 prepared batches are dispatched without a count rejection');
			let f = fixture();
			f.socket.connected = false;
			await f.owner.upload(command('offline')).then(
				() => {
					throw Error('offline accepted');
				},
				(error) =>
					expect(
						error.code === 'not_connected' && !error.outcomeUnknown,
						'ACK/offline gate rejects before dispatch',
					),
			);
			expect(f.calls.length === 0, 'offline upload cannot open control transport');
			f.socket.connected = true;
			await f.owner.upload({ ...command('scope'), destination: { scopeId: 'elsewhere', path: '/root' } }).then(
				() => {
					throw Error('scope accepted');
				},
				(error) => expect(error.code === 'invalid_input', 'upload rejects another Workspace scope'),
			);
			await f.owner
				.prepare({ id: 'prepare', destination: command('x').destination, directories: ['safe', '../escape'] })
				.then(
					() => {
						throw Error('escape accepted');
					},
					() => expect(f.calls.length === 0, 'entire directory plan rejected before first side effect'),
				);
			await f.owner
				.prepare({ id: 'large', destination: command('x').destination, directories: ['x'.repeat(4091)] })
				.then(
					() => {
						throw Error('full path accepted');
					},
					() => expect(f.calls.length === 0, 'full joined directory path has its own byte budget'),
				);
			f.owner.dispose();

			f = fixture();
			let ack;
			f.hook((type, input) => {
				if (type !== 'upload.start') return true;
				f.publish({ type: 'ready', uploadId: input.uploadId });
				return new Promise((resolve) => {
					ack = resolve;
				});
			});
			streams = [];
			await f.owner.upload(command('early'));
			expect(streams.length === 0, 'ready before start response does not dispatch byte stream');
			ack({ started: true });
			await tick();
			expect(
				streams.length === 1 &&
					new URL(streams[0].url).searchParams.get('workspaceId') === 'workspace-original',
				'stream uses original Workspace after both acknowledgements',
			);
			expect(
				!f.events.some((event) => event.type === 'completed'),
				'sending all bytes does not declare completion',
			);
			await until(() => streams[0].sentBytes === 1);
			f.publish({
				type: 'progress',
				uploadId: 'early',
				chunkIndex: 0,
				bytesWritten: 1,
				totalSize: 1,
				progress: 100,
			});
			f.publish(completed('early', '/root/file.txt', 1));
			expect(f.events.at(-1)?.type === 'completed', 'strict final metadata confirms completed upload');
			f.owner.dispose();

			f = fixture();
			streams = [];
			await f.owner.upload(command('zero', 0));
			await tick();
			f.publish(completed('zero', '/root/file.txt', 0));
			expect(
				streams.length === 0 && f.events.at(-1)?.type === 'completed',
				'zero-byte terminal never creates binary socket',
			);
			f.owner.dispose();

			f = fixture();
			mode = 'close';
			await f.owner.upload(command('preopen'));
			await tick();
			f.publish({ type: 'ready', uploadId: 'preopen' });
			await tick();
			expect(
				f.events.at(-1)?.errorKind === 'upload_unknown' && !f.owner.owns('preopen'),
				'close before open settles task as unknown',
			);
			mode = 'open';
			f.owner.dispose();

			f = fixture();
			await f.owner.upload(command('disconnect'));
			await tick();
			f.socket.connected = false;
			f.owner.disconnect();
			expect(
				f.events.at(-1)?.errorKind === 'upload_unknown',
				'dispatched upload remains unknown after disconnect',
			);
			const starts = f.calls.filter((call) => call.type === 'upload.start').length;
			f.socket.connected = true;
			f.owner.connect();
			await tick();
			expect(
				f.calls.filter((call) => call.type === 'upload.start').length === starts,
				'reconnect never replays upload start',
			);
			const beforeLate = f.events.length;
			f.publish(completed('disconnect', '/root/file.txt', 1));
			expect(f.events.length === beforeLate, 'old terminal cannot overwrite unknown task');
			f.owner.dispose();

			f = fixture();
			for (let index = 0; index < 7; index++) await f.owner.upload(command('queue-' + index));
			expect(
				f.calls.filter((call) => call.type === 'upload.start').length === 6,
				'private scheduler bounds admitted upload streams',
			);
			await f.owner.cancel('queue-6');
			expect(
				f.events.some((event) => event.id === 'queue-6' && event.type === 'cancelled') &&
					!f.calls.some((call) => call.payload.uploadId === 'queue-6'),
				'queued cancellation is confirmed without remote dispatch',
			);
			f.socket.connected = false;
			f.owner.disconnect();
			f.owner.dispose();

			f = fixture();
			await f.owner.upload(command('cancel'));
			await tick();
			expect(await f.owner.cancel('cancel'), 'cancel admission response is decoded');
			expect(
				!f.events.some((event) => event.type === 'cancelled'),
				'cancel admission is not cleanup confirmation',
			);
			f.publish({ type: 'failed', uploadId: 'cancel', message: 'operation_unknown' });
			expect(
				f.events.at(-1)?.errorKind === 'upload_unknown',
				'unconfirmed remote cancellation preserves unknown',
			);
			f.owner.dispose();

			f = fixture();
			await f.owner.upload(command('bad-event'));
			await tick();
			f.publish({ type: 'failed', uploadId: 'bad-event', message: 'raw technical secret' });
			expect(
				f.events.at(-1)?.errorKind === 'upload_unknown' && !JSON.stringify(f.events).includes('technical'),
				'malformed event does not leak technical text or imply rollback',
			);
			f.owner.dispose();

			f = fixture();
			await f.owner.upload(command('wrong-path', 0));
			await tick();
			f.publish(completed('wrong-path', '/other/file.txt', 0));
			expect(f.events.at(-1)?.errorKind === 'upload_unknown', 'valid shape for another destination is rejected');
			f.owner.dispose();

			f = fixture();
			let lostReply;
			f.hook((type) =>
				type === 'upload.start'
					? new Promise((_, reject) => {
							lostReply = reject;
						})
					: true,
			);
			await f.owner.upload(command('lost-reply'));
			lostReply(new Error('controlled response loss'));
			await tick();
			expect(
				f.events.at(-1)?.errorKind === 'upload_unknown' &&
					f.calls.filter((call) => call.type === 'upload.start').length === 1,
				'lost start reply preserves unknown without automatic replay',
			);
			f.owner.dispose();

			f = fixture();
			let preparationReply;
			f.hook((type) =>
				type === 'upload.prepare'
					? new Promise((resolve) => {
							preparationReply = resolve;
						})
					: true,
			);
			const preparation = f.owner.prepare({
				id: 'late-prepare',
				destination: command('x').destination,
				directories: [],
			});
			f.owner.disconnect();
			f.owner.connect();
			preparationReply({ preparedDirectories: 1 });
			await preparation.then(
				() => {
					throw Error('late prepare accepted');
				},
				(error) =>
					expect(
						error.outcomeUnknown,
						'late directory preparation remains unknown across attachment generation',
					),
			);
			await f.owner.upload({ ...command('prepared-file'), prepareId: 'late-prepare' }).then(
				() => {
					throw Error('stale prepare reused');
				},
				(error) =>
					expect(
						error.code === 'invalid_input',
						'late prepare cannot authorize files on replacement attachment',
					),
			);
			f.owner.dispose();

			f = fixture();
			streams = [];
			await f.owner.upload(command('order', 2));
			await tick();
			f.publish({ type: 'ready', uploadId: 'order' });
			await until(() => streams[0]?.sentBytes === 2);
			f.publish({
				type: 'progress',
				uploadId: 'order',
				chunkIndex: 1,
				bytesWritten: 2,
				totalSize: 2,
				progress: 100,
			});
			expect(f.events.at(-1)?.errorKind === 'upload_unknown', 'out-of-order progress cannot confirm upload');
			f.owner.dispose();

			let listener;
			const channel = {
				onEvent(handler) {
					listener = handler;
					return () => {};
				},

				upload: async () => {},

				prepareUpload: async () => {},

				cancel: async () => true,
			};
			const controller = createTransferController(channel);
			try {
				const [id] = await controller.startUploadBatch([new File(['x'], 'file.txt')], command('x').destination);
				await controller.cancel(id);
				expect(
					controller.tasks.value[0].status === 'cancelling',
					'controller waits beyond accepted cancel response',
				);
				listener({ type: 'error', id, errorKind: 'upload_unknown' });
				expect(
					(await controller.waitForTask(id)).status === 'unknown' && controller.active.value.length === 0,
					'unknown settles waiters and remains visible for manual recovery',
				);
				listener({ type: 'progress', id, progress: 100 });
				expect(controller.tasks.value[0].status === 'unknown', 'late progress cannot revive terminal unknown');
			} finally {
				controller.dispose();
			}
			let releasePrepare;
			let pendingUploads = 0;
			const preparing = createTransferController({
				...channel,

				prepareUpload: () =>
					new Promise((resolve) => {
						releasePrepare = resolve;
					}),

				upload: async () => {
					pendingUploads++;
				},
			});
			try {
				const batch = preparing.startUploadBatch(
					[{ file: new File(['x'], 'file.txt'), relativeDirectory: 'nested' }],
					command('x').destination,
				);
				const id = preparing.tasks.value[0].id;
				await preparing.cancel(id);
				releasePrepare();
				await batch;
				expect(
					preparing.tasks.value[0].status === 'cancelled' && pendingUploads === 0,
					'file cancelled during shared prepare is never dispatched afterward',
				);
			} finally {
				preparing.dispose();
			}
			return checks;
		} finally {
			for (const owner of owners) owner.dispose();
			window.WebSocket = NativeWebSocket;
		}
	});
	console.log(`Upload boundaries: ${codecChecks} codec + ${checks.length} browser checks PASS`);
	console.log(checks.join('\n'));
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) throw new AggregateError(failures, 'Upload fixture cleanup failed');
}

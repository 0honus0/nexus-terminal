import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Readable, Writable } from 'node:stream';
import {
	REMOTE_FILE_MAX_WRITE_REQUEST_BYTES,
	REMOTE_FILE_MAX_TEXT_BYTES,
} from '../../../packages/shared/dist/remote/files/values.js';
import {
	InvalidRemoteFilePayload,
	readRemoteFileWriteTextRequest,
} from '../../../packages/shared/dist/remote/files/http-codec.js';
import { MachineSftpFailure } from '../../../packages/backend-next/dist/platform/ssh/ssh-port.js';
import { SshSftpLease } from '../../../packages/backend-next/dist/platform/ssh/adapters/ssh2/ssh-sftp.js';
import { openHttpListener } from '../../../packages/backend-next/dist/platform/http/http-server.js';
import { SftpFileResource } from '../../../packages/backend-next/dist/modules/remote/files/model/file-resource.js';
import { RemoteFileFailure } from '../../../packages/backend-next/dist/modules/remote/files/model/file-types.js';
import { RemoteFileService } from '../../../packages/backend-next/dist/modules/remote/files/service/file-service.js';
import { createRemoteFileHttpRoutes } from '../../../packages/backend-next/dist/modules/remote/interfaces/http/file-http.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend-next/dist/modules/remote/resource-errors.js';

function sftpError(code, message) {
	return Object.assign(new Error(message), { code });
}

function machineFailure(code, message = 'fixture SFTP failure') {
	return new MachineSftpFailure('operation_failed', 'failed', {
		cause: sftpError(code, message),
		remoteStatus: code === 2 ? 'not_found' : code === 3 ? 'permission_denied' : 'failure',
	});
}

class MemoryLease {
	constructor(entries) {
		this.entries = entries;
		this.closed = false;
		this.unknownRemoveOnce = false;
		this.mutateTargetAfterTempWrite = null;
		this.createDestinationBeforeRename = null;
		this.denyRemovePath = null;
	}

	entry(path) {
		const value = this.entries.get(path);
		if (!value) throw machineFailure(2, 'missing');
		return value;
	}

	info(entry) {
		return {
			uid: 0,
			gid: 0,
			accessedAt: 1_700_000_000,
			size: entry.kind === 'file' ? entry.data.byteLength : 0,
			mode: entry.mode,
			modifiedAt: 1_700_000_000,
			isDirectory: entry.kind === 'directory',
			isFile: entry.kind === 'file',
			isSymbolicLink: entry.kind === 'symlink',
		};
	}

	async stat(path) {
		return this.info(this.entry(path));
	}

	async lstat(path) {
		return this.info(this.entry(path));
	}

	async list() {
		return [];
	}

	read(path) {
		const entry = this.entry(path);
		if (entry.kind !== 'file') throw machineFailure(4, 'not a file');
		return Readable.from([entry.data]);
	}

	async *readChunks(path, options = {}) {
		const bytes = this.entry(path).data;
		yield Uint8Array.from(
			bytes.subarray(options.start ?? 0, options.end === undefined ? bytes.length : options.end + 1),
		);
	}

	async writeFile(path, bytes, options) {
		const stream = this.write(path, options);
		stream.end(Buffer.from(bytes));
		await new Promise((resolve, reject) => {
			stream.once('finish', resolve);
			stream.once('error', reject);
		});
	}

	write(path, options = {}) {
		const chunks = [];
		return new Writable({
			write: (chunk, _encoding, callback) => {
				chunks.push(Buffer.from(chunk));
				callback();
			},

			final: (callback) => {
				if (options.flags === 'wx' && this.entries.has(path)) {
					callback(sftpError(4, 'exists'));
					return;
				}
				this.entries.set(path, {
					kind: 'file',
					data: Buffer.concat(chunks),
					mode: options.mode ?? 0o600,
				});
				if (path.includes('/.nexus-save-') && this.mutateTargetAfterTempWrite) {
					this.entries.set(this.mutateTargetAfterTempWrite, {
						kind: 'file',
						data: Buffer.from('concurrent writer'),
						mode: 0o600,
					});
					this.mutateTargetAfterTempWrite = null;
				}
				callback();
			},
		});
	}

	async rename(from, to) {
		const entry = this.entry(from);
		if (from.includes('/.nexus-save-') && this.createDestinationBeforeRename === to) {
			this.entries.set(to, { kind: 'file', data: Buffer.from('external create'), mode: 0o600 });
			this.createDestinationBeforeRename = null;
		}
		if (this.entries.has(to)) throw machineFailure(4, 'destination exists');
		this.entries.delete(from);
		this.entries.set(to, entry);
	}

	async replace(from, to) {
		const entry = this.entry(from);
		this.entries.delete(from);
		this.entries.set(to, entry);
	}

	async remove(path) {
		if (path === this.denyRemovePath) throw machineFailure(3, 'permission denied');
		const entry = this.entry(path);
		if (entry.kind === 'directory') throw machineFailure(4, 'is directory');
		this.entries.delete(path);
		if (this.unknownRemoveOnce) {
			this.unknownRemoveOnce = false;
			throw new MachineSftpFailure('timeout', 'unknown');
		}
	}

	async mkdir(path) {
		if (this.entries.has(path)) throw machineFailure(4, 'exists');
		this.entries.set(path, { kind: 'directory', mode: 0o755 });
	}

	async rmdir(path) {
		const entry = this.entry(path);
		if (entry.kind !== 'directory') throw machineFailure(4, 'not directory');
		const prefix = path.endsWith('/') ? path : path + '/';
		if ([...this.entries.keys()].some((name) => name.startsWith(prefix))) {
			throw machineFailure(4, 'not empty');
		}
		this.entries.delete(path);
	}

	async close() {
		this.closed = true;
	}
}

function sha(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function request(listener, method, path, body, token = 'good') {
	const port = Number(listener.address.split(':').at(-1));
	const encoded = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				hostname: '127.0.0.1',
				port,
				method,
				path,
				headers: {
					Host: '127.0.0.1:0',
					Origin: 'http://127.0.0.1:0',
					Cookie: 'nexus_session=' + token,
					...(encoded === undefined
						? {}
						: {
								'Content-Type': 'application/json',
								'Content-Length': Buffer.byteLength(encoded),
							}),
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					try {
						resolve({
							status: response.statusCode,
							body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on('error', reject);
		req.end(encoded);
	});
}

async function rawRequest(listener, method, path, body, token = 'good') {
	const port = Number(listener.address.split(':').at(-1));
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{
				hostname: '127.0.0.1',
				port,
				method,
				path,
				headers: {
					Host: '127.0.0.1:0',
					Origin: 'http://127.0.0.1:0',
					Cookie: 'nexus_session=' + token,
					'Content-Type': 'application/json',
					'Content-Length': body.byteLength,
				},
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('error', reject);
				response.on('end', () => {
					try {
						resolve({
							status: response.statusCode,
							body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on('error', reject);
		req.end(body);
	});
}

function callbackSftp(rename) {
	const value = new EventEmitter();
	value.rename = rename;
	value.end = () => queueMicrotask(() => value.emit('close'));
	value.destroy = () => queueMicrotask(() => value.emit('close'));
	return value;
}

async function platformOutcomeClassification() {
	{
		const sftp = callbackSftp(() => undefined);
		const lease = new SshSftpLease(sftp, () => undefined);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			Promise.resolve().then(() => lease.rename('/a', '/b', { signal: controller.signal })),
			(error) => error instanceof MachineSftpFailure && error.outcome === 'not_started',
		);
		await lease.close();
	}
	{
		const sftp = callbackSftp((_from, _to, callback) =>
			queueMicrotask(() => callback(sftpError(4, 'remote rejected'))),
		);
		const lease = new SshSftpLease(sftp, () => undefined);
		await assert.rejects(
			lease.rename('/a', '/b'),
			(error) => error instanceof MachineSftpFailure && error.outcome === 'failed',
		);
		await lease.close();
	}
	{
		const sftp = callbackSftp(() => undefined);
		const lease = new SshSftpLease(sftp, () => undefined);
		const controller = new AbortController();
		const pending = lease.rename('/a', '/b', { signal: controller.signal, timeoutMs: 1000 });
		queueMicrotask(() => controller.abort());
		await assert.rejects(pending, (error) => error instanceof MachineSftpFailure && error.outcome === 'unknown');
	}
}

async function cleanupAndLateOpenLifecycle() {
	const cleanupErrors = [new Error('lease cleanup failed'), new Error('machine cleanup failed')];
	const cleanupResource = new SftpFileResource(
		1,
		'f'.repeat(64),
		{
			isOpen: true,

			close: async () => Promise.reject(cleanupErrors[1]),
		},
		{ close: async () => Promise.reject(cleanupErrors[0]) },
	);
	const firstClose = cleanupResource.close();
	const secondClose = cleanupResource.close();
	assert.strictEqual(firstClose, secondClose);
	await assert.rejects(
		firstClose,
		(error) =>
			error instanceof RemoteResourceCleanupFailure && cleanupErrors.every((item) => error.errors.includes(item)),
	);

	let releaseLate;
	const lateOpening = new Promise((resolve) => {
		releaseLate = resolve;
	});
	let enteredLateOpen;
	const lateOpenEntered = new Promise((resolve) => {
		enteredLateOpen = resolve;
	});
	let openCount = 0;
	let lateCloseCount = 0;

	const disposable = () => ({
		targetId: 1,
		fingerprint: 'f'.repeat(64),
		isOpen: true,

		close: async () => undefined,
	});

	const lateResource = {
		...disposable(),

		close: async () => {
			lateCloseCount += 1;
		},
	};
	const model = {
		open: async () => {
			openCount += 1;
			if (openCount === 1) {
				enteredLateOpen();
				return lateOpening;
			}
			return disposable();
		},

		checkFingerprint: async () => undefined,
	};
	const access = { authenticate: async () => ({ userId: 1 }) };
	const service = new RemoteFileService(access, model, { get: async () => ({ name: 'Fixture target' }) });
	const controller = new AbortController();
	const cancelled = service.open('good', 1, controller.signal);
	await lateOpenEntered;
	controller.abort();
	await assert.rejects(
		cancelled,
		(error) => error instanceof RemoteFileFailure && error.code === 'remote_unavailable',
	);
	const held = [];
	for (let index = 0; index < 7; index += 1) {
		held.push(await service.open('good', index + 2));
	}
	await assert.rejects(
		service.open('good', 20),
		(error) => error instanceof RemoteFileFailure && error.code === 'limit_exceeded',
	);
	releaseLate(lateResource);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(lateCloseCount, 1, 'late successful open must be closed by its original owner');
	held.push(await service.open('good', 21));
	await service.close();
}

async function lateRejectedOpenCleanupEvidence() {
	let enteredOpen;
	const entered = new Promise((resolve) => {
		enteredOpen = resolve;
	});
	let rejectOpen;
	const opening = new Promise((_, reject) => {
		rejectOpen = reject;
	});
	const model = {
		open: async () => {
			enteredOpen();
			return opening;
		},

		checkFingerprint: async () => undefined,
	};
	const service = new RemoteFileService({ authenticate: async () => ({ userId: 1 }) }, model, {
		get: async () => ({ name: 'Fixture target' }),
	});
	const controller = new AbortController();
	const cancelled = service.open('good', 1, controller.signal);
	await entered;
	controller.abort();
	await assert.rejects(
		cancelled,
		(error) => error instanceof RemoteFileFailure && error.code === 'remote_unavailable',
	);
	const cleanup = new RemoteResourceCleanupFailure([new Error('late SFTP cleanup failed')]);
	rejectOpen(cleanup);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(service.close(), (error) => error instanceof AggregateError && error.errors.includes(cleanup));
}

function sharedCapacityAndUnicode() {
	const chineseCount = Math.floor(REMOTE_FILE_MAX_TEXT_BYTES / 3);
	const suffixBytes = REMOTE_FILE_MAX_TEXT_BYTES - chineseCount * 3;
	const exact = '中'.repeat(chineseCount) + 'a'.repeat(suffixBytes);
	assert.equal(Buffer.byteLength(exact, 'utf8'), REMOTE_FILE_MAX_TEXT_BYTES);
	assert.equal(
		readRemoteFileWriteTextRequest({ path: '/容量.txt', text: exact, expectedSha256: null }).text.length,
		exact.length,
	);
	assert.throws(
		() => readRemoteFileWriteTextRequest({ path: '/容量.txt', text: exact + '中', expectedSha256: null }),
		InvalidRemoteFilePayload,
	);
	const escaped = '\\'.repeat(REMOTE_FILE_MAX_TEXT_BYTES);
	const escapedRequest = { path: '/escaped.txt', text: escaped, expectedSha256: null };
	assert.ok(Buffer.byteLength(JSON.stringify(escapedRequest), 'utf8') <= REMOTE_FILE_MAX_WRITE_REQUEST_BYTES);
	assert.equal(readRemoteFileWriteTextRequest(escapedRequest).text.length, REMOTE_FILE_MAX_TEXT_BYTES);
	assert.equal(
		readRemoteFileWriteTextRequest({ path: '/emoji-😀.txt', text: 'A😀B', expectedSha256: null }).text,
		'A😀B',
	);
	assert.throws(
		() => readRemoteFileWriteTextRequest({ path: '/bad.txt', text: 'bad\u0000text', expectedSha256: null }),
		InvalidRemoteFilePayload,
	);
}

async function fullMutationChain() {
	const entries = new Map([
		['/note.txt', { kind: 'file', data: Buffer.from('old', 'utf8'), mode: 0o640 }],
		['/link.txt', { kind: 'symlink', target: '/note.txt', mode: 0o777 }],
	]);
	const lease = new MemoryLease(entries);
	const machine = {
		isOpen: true,

		async close() {
			this.isOpen = false;
		},
	};
	const resource = new SftpFileResource(7, 'f'.repeat(64), machine, lease);
	let stale = false;
	const model = {
		async open() {
			return resource;
		},

		async checkFingerprint() {
			if (stale) throw new RemoteFileFailure('stale_target');
		},
	};
	const access = {
		authenticate: async (token) => (token === 'good' ? { userId: 1 } : token === 'other' ? { userId: 2 } : null),
	};
	const files = new RemoteFileService(access, model, { get: async () => ({ name: 'Fixture target' }) });
	const listener = await openHttpListener({
		port: 0,
		bindHost: '127.0.0.1',
		publicOrigin: 'http://127.0.0.1:0',
		trustedProxies: [],
		routes: createRemoteFileHttpRoutes(files),
		webSockets: [],
	});
	try {
		const opened = await request(listener, 'POST', '/api/v1/remote/files/resources', { targetId: 7 });
		assert.equal(opened.status, 201);
		const id = opened.body.id;
		const root = '/api/v1/remote/files/resources/' + id;

		const initial = await request(listener, 'POST', root + '/read-text', { path: '/note.txt' });
		assert.equal(initial.status, 200);
		assert.equal(initial.body.text, 'old');
		assert.equal(initial.body.sha256, sha('old'));

		const replaced = await request(listener, 'POST', root + '/write-text', {
			path: '/note.txt',
			text: '新内容',
			expectedSha256: initial.body.sha256,
		});
		assert.equal(replaced.status, 200);
		assert.equal(replaced.body.status, 'replaced');
		assert.equal(replaced.body.bytes, Buffer.byteLength('新内容'));
		assert.equal(entries.get('/note.txt').mode, 0o640);
		assert.equal(entries.get('/note.txt').data.toString('utf8'), '新内容');

		const conflict = await request(listener, 'POST', root + '/write-text', {
			path: '/note.txt',
			text: 'must not win',
			expectedSha256: sha('old'),
		});
		assert.deepEqual(conflict, { status: 409, body: { code: 'conflict' } });
		assert.equal(entries.get('/note.txt').data.toString('utf8'), '新内容');

		const symlinkWrite = await request(listener, 'POST', root + '/write-text', {
			path: '/link.txt',
			text: 'blocked',
			expectedSha256: null,
		});
		assert.deepEqual(symlinkWrite, { status: 409, body: { code: 'conflict' } });

		const invalidText = await request(listener, 'POST', root + '/write-text', {
			path: '/invalid.txt',
			text: 'bad\u0000text',
			expectedSha256: null,
		});
		assert.deepEqual(invalidText, { status: 400, body: { code: 'invalid_input' } });
		assert.equal(entries.has('/invalid.txt'), false);

		entries.set('/race.txt', { kind: 'file', data: Buffer.from('before'), mode: 0o600 });
		lease.mutateTargetAfterTempWrite = '/race.txt';
		const race = await request(listener, 'POST', root + '/write-text', {
			path: '/race.txt',
			text: 'ours',
			expectedSha256: sha('before'),
		});
		assert.deepEqual(race, { status: 409, body: { code: 'conflict' } });
		assert.equal(entries.get('/race.txt').data.toString(), 'concurrent writer');
		assert.equal(
			[...entries.keys()].some((name) => name.includes('/.nexus-save-')),
			false,
			'determined conflict must clean its temporary file',
		);

		const created = await request(listener, 'POST', root + '/write-text', {
			path: '/created.txt',
			text: '',
			expectedSha256: null,
		});
		assert.equal(created.status, 201);
		assert.equal(created.body.status, 'created');
		assert.equal(entries.get('/created.txt').mode, 0o600);

		lease.createDestinationBeforeRename = '/exclusive.txt';
		const exclusive = await request(listener, 'POST', root + '/write-text', {
			path: '/exclusive.txt',
			text: 'ours',
			expectedSha256: null,
		});
		assert.notEqual(exclusive.status, 200);
		assert.notEqual(exclusive.status, 201);
		assert.equal(entries.get('/exclusive.txt').data.toString(), 'external create');
		assert.equal(
			[...entries.keys()].some((name) => name.includes('/.nexus-save-')),
			false,
			'determined new-file race must clean its temporary file',
		);

		const invalidUtf8 = Buffer.concat([
			Buffer.from('{"path":"/wire.txt","text":"', 'utf8'),
			Buffer.from([0xc3]),
			Buffer.from('","expectedSha256":null}', 'utf8'),
		]);
		assert.deepEqual(await rawRequest(listener, 'POST', root + '/write-text', invalidUtf8), {
			status: 400,
			body: { code: 'invalid_json' },
		});
		assert.equal(entries.has('/wire.txt'), false);

		assert.equal((await request(listener, 'POST', root + '/mkdir', { path: '/dir' })).status, 201);
		assert.deepEqual(
			await request(listener, 'POST', root + '/rename', {
				from: '/created.txt',
				to: '/dir/moved.txt',
			}),
			{
				status: 200,
				body: { from: '/created.txt', to: '/dir/moved.txt', kind: 'file' },
			},
		);
		assert.equal((await request(listener, 'POST', root + '/remove', { path: '/dir/moved.txt' })).status, 200);
		assert.equal((await request(listener, 'POST', root + '/rmdir', { path: '/dir' })).status, 200);

		assert.equal(
			(await request(listener, 'POST', root + '/rename', { from: '/link.txt', to: '/renamed-link' })).status,
			200,
		);
		assert.equal(entries.get('/renamed-link').kind, 'symlink');
		assert.equal((await request(listener, 'POST', root + '/remove', { path: '/renamed-link' })).status, 200);
		assert.deepEqual(await request(listener, 'POST', root + '/remove', { path: '/missing.txt' }), {
			status: 404,
			body: { code: 'not_found' },
		});

		entries.set('/denied.txt', { kind: 'file', data: Buffer.from('keep'), mode: 0o600 });
		lease.denyRemovePath = '/denied.txt';
		const denied = await request(listener, 'POST', root + '/remove', { path: '/denied.txt' });
		assert.equal(denied.status, 503);
		assert.equal(entries.has('/denied.txt'), true);
		lease.denyRemovePath = null;

		await request(listener, 'POST', root + '/mkdir', { path: '/nonempty' });
		entries.set('/nonempty/file', { kind: 'file', data: Buffer.from('x'), mode: 0o600 });
		const nonempty = await request(listener, 'POST', root + '/rmdir', { path: '/nonempty' });
		assert.notEqual(nonempty.status, 200);
		assert.equal(entries.has('/nonempty'), true);

		assert.deepEqual(await request(listener, 'POST', root + '/mkdir', { path: '/' }), {
			status: 400,
			body: { code: 'invalid_input' },
		});
		assert.deepEqual(await request(listener, 'POST', root + '/mkdir', { path: '/denied' }, 'other'), {
			status: 403,
			body: { code: 'forbidden' },
		});

		stale = true;
		assert.deepEqual(
			await request(listener, 'POST', root + '/write-text', {
				path: '/stale.txt',
				text: 'no side effect',
				expectedSha256: null,
			}),
			{
				status: 409,
				body: { code: 'stale_target' },
			},
		);
		assert.equal(entries.has('/stale.txt'), false);
		stale = false;

		const cancelled = new AbortController();
		cancelled.abort();
		await assert.rejects(
			files.remove('good', id, '/note.txt', cancelled.signal),
			(error) => error instanceof RemoteFileFailure && error.code === 'remote_unavailable',
		);
		assert.equal(entries.has('/note.txt'), true, 'pre-dispatch cancellation must have no mutation side effect');

		entries.set('/unknown.txt', { kind: 'file', data: Buffer.from('x'), mode: 0o600 });
		lease.unknownRemoveOnce = true;
		assert.deepEqual(await request(listener, 'POST', root + '/remove', { path: '/unknown.txt' }), {
			status: 503,
			body: { code: 'operation_unknown' },
		});
		assert.equal(entries.has('/unknown.txt'), false, 'fixture proves unknown may include a completed side effect');
	} finally {
		await listener.close();
		await files.close().catch(() => undefined);
	}
}

await platformOutcomeClassification();
console.log('B1 Platform SFTP not-started/failed/unknown classification PASS');
await cleanupAndLateOpenLifecycle();
console.log('B1 cleanup aggregation / late-open quota lifecycle PASS');
await lateRejectedOpenCleanupEvidence();
console.log('B1 late rejected open preserves cleanup evidence PASS');
sharedCapacityAndUnicode();
console.log('B1 Shared UTF-8/JSON text capacity and Unicode validation PASS');
await fullMutationChain();
console.log('B1 Remote Files write/create/rename/remove/mkdir/rmdir HTTP-Service-Model chain PASS');

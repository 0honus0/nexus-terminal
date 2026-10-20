import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SecureSessionTokens } from '../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';
import { MachineSftpFailure } from '../../../packages/backend/dist/platform/ssh/ssh-port.js';
import { initializeMachineMutations } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-schema.js';
import { SqliteMachineMutationStorage } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
import { MachineMutationModel } from '../../../packages/backend/dist/modules/remote/machines/model/mutation-model.js';
import { MachineMutationService } from '../../../packages/backend/dist/modules/remote/machines/service/mutation-service.js';
import { RemoteFileService } from '../../../packages/backend/dist/modules/remote/files/service/file-service.js';
import { SftpFileResource } from '../../../packages/backend/dist/modules/remote/files/model/file-resource.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';
import { until } from './openssh-fixture.mjs';

const token = 'transfer-owner-session';
const fingerprint = 'f'.repeat(64);
const workspaceAuthority = { isCurrent: () => true };

function gate() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function observe(promise) {
	return promise.then(
		(value) => ({ status: 'fulfilled', value }),
		(error) => ({ status: 'rejected', error }),
	);
}

function includesCause(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => includesCause(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && includesCause(error.cause, expected))
	);
}

function failure(code) {
	return (error) => error instanceof RemoteFileFailure && error.code === code;
}

async function setup(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-transfer-ownership-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	await db.transaction(initializeMachineMutations);
	const tokens = new SecureSessionTokens();
	const state = { opening: null, mkdir: null, opens: [], closes: [], gates: [], expectedShutdown: null };

	function resource(targetId, options = {}) {
		const label = options.label ?? 'owner-' + targetId;
		const machine = {
			isOpen: true,

			async close() {
				state.closes.push(label + ':machine');
				this.isOpen = false;
				if (options.machineError) {
					throw options.machineError;
				}
			},
		};
		const lease = {
			async lstat(path) {
				const override = await state.lstat?.(path, targetId);
				if (override) {
					return override;
				}
				if (path !== '/') {
					throw new MachineSftpFailure('operation_failed', 'failed', { remoteStatus: 'not_found' });
				}
				return {
					uid: 0,
					gid: 0,
					accessedAt: 1700000000,
					modifiedAt: 1700000000,
					size: 0,
					mode: 0o755,
					isDirectory: true,
					isFile: false,
					isSymbolicLink: false,
				};
			},

			async stat(path) {
				return this.lstat(path);
			},

			readChunks(path, options) {
				return state.readChunks(path, options);
			},

			async mkdir(path) {
				await state.mkdir?.(path, targetId);
			},

			async close() {
				state.closes.push(label + ':lease');
				if (options.leaseError) {
					throw options.leaseError;
				}
			},
		};
		return new SftpFileResource(targetId, options.fingerprint ?? fingerprint, machine, lease);
	}

	const files = new RemoteFileService(
		{
			authenticate: async () => ({ userId: 1 }),

			authenticateDigest: async () => ({ userId: 1 }),
		},
		{
			digestToken: (value) => tokens.digest(value),

			async open(targetId) {
				state.opens.push(targetId);
				return state.opening?.(targetId) ?? resource(targetId);
			},

			checkFingerprint: async () => undefined,
		},
		{ get: async () => ({ name: 'Controlled transfer owner' }) },
		new MachineMutationService(
			new MachineMutationModel(
				new SqliteMachineMutationStorage(db),
				{ resolveStored: async ({ targetId }) => ({ host: 'transfer-' + targetId + '.local', port: 22 }) },
				tokens,
			),
		),
	);
	t.after(async () => {
		for (const pending of state.gates) {
			pending.resolve();
		}
		try {
			const result = await observe(files.close());
			if (state.expectedShutdown) {
				assert.equal(result.status, 'rejected');
				assert.strictEqual(result.error, state.expectedShutdown);
			} else if (result.status === 'rejected') {
				throw result.error;
			}
		} finally {
			await db.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
	return { files, state, resource };
}

await test('Files independent transfer ownership and mixed admission at controlled boundaries', async (t) => {
	for (const revokeAt of ['metadata', 'next_chunk', 'finish']) {
		await t.test(
			'download revocation before ' + revokeAt + ' prevents the next delivery and closes its producer',
			async (t) => {
				const f = await setup(t);
				let current = true;
				const attachment = await f.files.openWorkspace(token, 'download-workspace', 1, {
					isCurrent: () => current,
				});
				const payload = Buffer.from('ab');
				let producerClosed = false;
				const delivered = [];
				let plans = 0;
				let finishes = 0;
				f.state.lstat = async () => {
					if (revokeAt === 'metadata') {
						current = false;
					}
					return {
						uid: 0,
						gid: 0,
						accessedAt: 1700000000,
						modifiedAt: 1700000000,
						size: payload.length,
						mode: 0o600,
						isDirectory: false,
						isFile: true,
						isSymbolicLink: false,
					};
				};
				f.state.readChunks = async function* () {
					try {
						if (revokeAt === 'next_chunk') {
							yield payload.subarray(0, 1);
							yield payload.subarray(1);
						} else {
							yield payload;
						}
					} finally {
						producerClosed = true;
					}
				};
				await assert.rejects(
					f.files.downloadWorkspace(token, 'download-workspace', 1, '/download', { kind: 'all' }, true, {
						async plan() {
							plans += 1;
						},

						async write(bytes) {
							delivered.push(Buffer.from(bytes));
							current = false;
						},

						async finish() {
							finishes += 1;
						},
					}),
					failure('not_found'),
				);
				assert.equal(plans, revokeAt === 'metadata' ? 0 : 1);
				assert.equal(finishes, 0);
				assert.deepEqual(
					Buffer.concat(delivered),
					revokeAt === 'metadata'
						? Buffer.alloc(0)
						: revokeAt === 'next_chunk'
							? payload.subarray(0, 1)
							: payload,
				);
				assert.equal(producerClosed, revokeAt !== 'metadata');
				await attachment.release();
				assert.deepEqual(f.state.closes, ['owner-1:lease', 'owner-1:machine']);
			},
		);
	}

	for (const revokedSide of ['source', 'destination']) {
		await t.test(
			revokedSide + ' authority is rechecked after a held destination stat before the next copy RPC',
			async (t) => {
				const f = await setup(t);
				const current = { source: true, destination: true };
				const source = await f.files.openWorkspace(token, 'source-workspace', 1, {
					isCurrent: () => current.source,
				});
				const destination = await f.files.openWorkspace(token, 'destination-workspace', 2, {
					isCurrent: () => current.destination,
				});
				const entered = gate();
				const release = gate();
				f.state.gates.push(release);
				const stats = [];
				f.state.lstat = async (path, targetId) => {
					stats.push({ path, targetId });
					if (targetId === 2 && path === '/destination') {
						entered.resolve();
						await release.promise;
						return {
							uid: 0,
							gid: 0,
							accessedAt: 1700000000,
							modifiedAt: 1700000000,
							size: 0,
							mode: 0o755,
							isDirectory: true,
							isFile: false,
							isSymbolicLink: false,
						};
					}
				};
				const events = [];
				f.files.startCopyMove(
					token,
					'destination-workspace',
					'lease-copy',
					'copy',
					['/source'],
					'/destination',
					'source-workspace',
					(event) => events.push(event),
				);
				await entered.promise;
				current[revokedSide] = false;
				release.resolve();
				const terminal = await until(
					() => events.find((event) => event.type === 'failed' || event.type === 'completed'),
					Boolean,
					'Copy authority refusal',
				);
				assert.equal(terminal.type, 'failed');
				assert.equal(terminal.message, 'not_found');
				assert.deepEqual(stats, [{ path: '/destination', targetId: 2 }]);
				assert.deepEqual(f.state.opens, [1, 2, 1, 2]);
				await source.release();
				await destination.release();
				assert.equal(f.state.closes.length, 8);
			},
		);
	}

	for (const side of ['source', 'destination', 'both']) {
		await t.test(side + ' cleanup failure retains both Workspace reservations and the task identity', async (t) => {
			const f = await setup(t);
			const source = await f.files.openWorkspace(token, 'source-workspace', 1, workspaceAuthority);
			const destination = await f.files.openWorkspace(token, 'destination-workspace', 2, workspaceAuthority);
			const errors = [
				new Error('source lease cleanup'),
				new Error('source machine cleanup'),
				new Error('destination lease cleanup'),
				new Error('destination machine cleanup'),
			];
			const expected = side === 'both' ? errors : side === 'source' ? errors.slice(0, 2) : errors.slice(2);
			f.state.opening = (targetId) =>
				f.resource(
					targetId,
					targetId === 1
						? {
								label: 'transfer-source',
								leaseError: side === 'destination' ? undefined : errors[0],
								machineError: side === 'destination' ? undefined : errors[1],
							}
						: {
								label: 'transfer-destination',
								fingerprint: 'a'.repeat(64),
								leaseError: side === 'source' ? undefined : errors[2],
								machineError: side === 'source' ? undefined : errors[3],
							},
				);
			const events = [];
			f.files.startCopyMove(
				token,
				'destination-workspace',
				'copy-task',
				'copy',
				['/source'],
				'/destination',
				'source-workspace',
				(event) => events.push(event),
			);
			const terminal = await until(
				() => events.find((event) => event.type === 'failed'),
				Boolean,
				'Controlled copy terminal',
			);
			assert.equal(terminal.message, 'operation_unknown');
			assert.deepEqual(f.state.opens, [1, 2, 1, 2]);
			assert.deepEqual(f.state.closes, [
				'transfer-destination:lease',
				'transfer-destination:machine',
				'transfer-source:lease',
				'transfer-source:machine',
			]);
			assert.throws(
				() =>
					f.files.startCopyMove(
						token,
						'destination-workspace',
						'copy-task',
						'copy',
						['/source'],
						'/destination',
						'source-workspace',
						() => undefined,
					),
				failure('conflict'),
			);
			for (const attachment of [source, destination]) {
				const closed = await observe(attachment.release());
				assert.equal(closed.status, 'rejected');
				assert.ok(closed.error instanceof RemoteResourceCleanupFailure);
				for (const error of expected) {
					assert.ok(includesCause(closed.error, error), error.message);
				}
			}
			f.state.opening = null;
			await assert.rejects(
				f.files.openWorkspace(token, 'source-workspace', 1, workspaceAuthority),
				failure('conflict'),
			);
			await assert.rejects(
				f.files.openWorkspace(token, 'destination-workspace', 2, workspaceAuthority),
				failure('conflict'),
			);
			const healthy = [];
			for (let index = 0; index < 62; index += 1) {
				healthy.push(
					await f.files.openWorkspace(token, 'healthy-workspace-' + index, index + 3, workspaceAuthority),
				);
			}
			await assert.rejects(
				f.files.openWorkspace(token, 'overflow-workspace', 100, workspaceAuthority),
				failure('limit_exceeded'),
			);
			await healthy[0].release();
			const fenced = await f.files.openWorkspace(token, 'replacement-workspace', 2, workspaceAuthority);
			await assert.rejects(f.files.createDirectory(token, fenced.id, '/not-dispatched'), failure('conflict'));
			const shutdown = await observe(f.files.close());
			assert.equal(shutdown.status, 'rejected');
			for (const error of expected) {
				assert.ok(includesCause(shutdown.error, error));
			}
			f.state.expectedShutdown = shutdown.error;
		});
	}

	await t.test('prepare, upload, copy and archive share the exact 16/17 per-Workspace budget', async (t) => {
		const f = await setup(t);
		await f.files.openWorkspace(token, 'mixed-workspace', 1, workspaceAuthority);
		await f.files.openWorkspace(token, 'other-workspace', 2, workspaceAuthority);
		const entered = gate();
		const release = gate();
		f.state.gates.push(entered, release);
		f.state.mkdir = async () => {
			entered.resolve();
			await release.promise;
		};
		const prepared = observe(f.files.prepareUpload(token, 'mixed-workspace', 'prepare', '/queued-root', []));
		await entered.promise;
		const events = [];

		const emit = (event) => events.push(event);

		// Extraction has no pre-admission compression footprint reads; this fixture checks queued task capacity.
		for (let index = 0; index < 5; index += 1) {
			f.files.startUpload(
				token,
				'mixed-workspace',
				{
					uploadId: 'upload-' + index,
					destinationPath: '/upload-' + index,
					size: 1,
					conflictPolicy: 'overwrite',
				},
				emit,
			);
			f.files.startCopyMove(
				token,
				'mixed-workspace',
				'copy-' + index,
				'copy',
				['/source'],
				'/destination',
				undefined,
				emit,
			);
			f.files.startArchive(
				token,
				'mixed-workspace',
				'archive-' + index,
				{ kind: 'decompress', source: '/archive.zip' },
				emit,
			);
		}
		assert.throws(
			() =>
				f.files.startUpload(
					token,
					'mixed-workspace',
					{ uploadId: 'overflow-upload', destinationPath: '/overflow', size: 1, conflictPolicy: 'overwrite' },
					emit,
				),
			failure('limit_exceeded'),
		);
		assert.throws(
			() =>
				f.files.startCopyMove(
					token,
					'mixed-workspace',
					'overflow-copy',
					'copy',
					['/source'],
					'/destination',
					undefined,
					emit,
				),
			failure('limit_exceeded'),
		);
		assert.throws(
			() =>
				f.files.startArchive(
					token,
					'mixed-workspace',
					'overflow-archive',
					{ kind: 'decompress', source: '/overflow.zip' },
					emit,
				),
			failure('limit_exceeded'),
		);
		assert.throws(
			() => f.files.prepareUpload(token, 'mixed-workspace', 'overflow-prepare', '/', []),
			failure('limit_exceeded'),
		);
		const other = observe(f.files.prepareUpload(token, 'other-workspace', 'other-prepare', '/other-root', []));
		assert.equal(await f.files.cancelUpload(token, 'mixed-workspace', 'upload-0'), true);
		await until(
			() => events.find((event) => event.uploadId === 'upload-0' && ['failed', 'cancelled'].includes(event.type)),
			Boolean,
			'Queued upload cancellation',
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			f.files.startArchive(
				token,
				'mixed-workspace',
				'replacement-archive',
				{ kind: 'decompress', source: '/replacement.zip' },
				emit,
			).started,
			true,
		);
		assert.deepEqual(f.state.opens, [1, 2], 'queued transfers have not constructed independent resources');
		f.files.quiesce();
		release.resolve();
		assert.equal((await prepared).status, 'rejected');
		assert.equal((await other).status, 'rejected');
		await f.files.close();
		assert.deepEqual(f.state.opens, [1, 2]);
		assert.equal(events.filter((event) => ['failed', 'cancelled'].includes(event.type)).length, 16);
	});
});

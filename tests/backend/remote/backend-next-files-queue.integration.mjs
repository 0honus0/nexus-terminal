import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SecureSessionTokens } from '../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';
import { initializeMachineMutations } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-schema.js';
import { SqliteMachineMutationStorage } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
import { MachineMutationModel } from '../../../packages/backend/dist/modules/remote/machines/model/mutation-model.js';
import { MachineMutationService } from '../../../packages/backend/dist/modules/remote/machines/service/mutation-service.js';
import { SftpFileResource } from '../../../packages/backend/dist/modules/remote/files/model/file-resource.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { RemoteFileService } from '../../../packages/backend/dist/modules/remote/files/service/file-service.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';

const token = 'queue-session';
const fingerprint = 'f'.repeat(64);
const workspaceAuthority = { isCurrent: () => true };

function deferred() {
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

async function rejected(result, code) {
	const outcome = await result;
	assert.equal(outcome.status, 'rejected');
	assert.ok(outcome.error instanceof RemoteFileFailure);
	assert.equal(outcome.error.code, code);
	return outcome.error;
}

async function turn() {
	await new Promise((resolve) => setImmediate(resolve));
}

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-files-queue-'));
	const db = SqliteRuntime.open(join(directory, 'mutations.db'));
	const tokens = new SecureSessionTokens();
	const state = {
		live: true,
		stale: false,
		authentications: 0,
		resources: [],
		gates: [],
		settlements: [],
		afterSettle: null,
		open: null,
		authenticate: null,
		catalog: null,
		expectedShutdownFailure: null,
	};

	state.gate = () => {
		const value = deferred();
		state.gates.push(value);
		return value;
	};

	state.resource = (targetId = 1, cleanup = {}) => {
		const dispatched = [];
		const applied = [];
		const firstEntered = state.gate();
		const firstRelease = state.gate();
		const closeEvents = [];
		const machine = {
			isOpen: true,

			async close() {
				closeEvents.push('machine');
				await cleanup.machine?.();
				this.isOpen = false;
			},
		};
		const lease = {
			async mkdir(path) {
				dispatched.push(path);
				if (path === '/first') {
					firstEntered.resolve();
					// Deliberately retain the real operation past cancellation at this controlled SFTP seam.
					await firstRelease.promise;
				}
				applied.push(path);
			},

			async close() {
				closeEvents.push('lease');
				await cleanup.lease?.();
			},
		};
		const value = {
			resource: new SftpFileResource(targetId, fingerprint, machine, lease),
			dispatched,
			applied,
			firstEntered,
			firstRelease,
			closeEvents,
		};
		state.resources.push(value);
		return value;
	};

	class ObservedMutationModel extends MachineMutationModel {
		async settle(claim, blocked) {
			await super.settle(claim, blocked);
			state.settlements.push(blocked);
			state.afterSettle?.();
		}
	}

	await db.transaction(initializeMachineMutations);
	const mutations = new MachineMutationService(
		new ObservedMutationModel(
			new SqliteMachineMutationStorage(db),
			{ resolveStored: async ({ targetId }) => ({ host: `queue-${targetId}.local`, port: 22 }) },
			tokens,
		),
	);
	const files = new RemoteFileService(
		{
			async authenticate() {
				state.authentications += 1;
				if (state.authenticate) {
					return state.authenticate();
				}
				return state.live ? { userId: 1 } : null;
			},
		},
		{
			digestToken: (value) => tokens.digest(value),

			open: async (targetId) => state.open?.(targetId) ?? state.resource(targetId).resource,

			async checkFingerprint() {
				if (state.stale) {
					throw new RemoteFileFailure('stale_target');
				}
			},
		},
		{ get: async () => state.catalog?.() ?? { name: 'Queue fixture' } },
		mutations,
	);
	t.after(async () => {
		for (const gate of state.gates) {
			gate.resolve();
		}
		try {
			const shutdown = await observe(files.close());
			if (state.expectedShutdownFailure) {
				assert.equal(shutdown.status, 'rejected');
				assert.strictEqual(shutdown.error, state.expectedShutdownFailure);
			} else if (shutdown.status === 'rejected') {
				throw shutdown.error;
			}
		} finally {
			await db.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
	return { ...state, state, files };
}

async function queue(f, id, path, signal) {
	const before = f.state.authentications;
	const result = observe(f.files.createDirectory(token, id, path, signal));
	await turn();
	assert.ok(f.state.authentications > before, 'the queued request completed its admission identity lookup');
	assert.deepEqual(f.resources[0].dispatched, ['/first']);
	return { result };
}

test('Files mutation queue and Workspace reservation lifecycle at controlled boundaries', async (t) => {
	await t.test('queued mutations reject a Workspace authority revoked after admission', async (t) => {
		const f = await fixture(t);
		let current = true;
		const attachment = await f.files.openWorkspace(token, 'authority-workspace', 1, { isCurrent: () => current });
		const resource = f.resources[0];
		const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
		await resource.firstEntered.promise;
		const second = await queue(f, attachment.id, '/must-not-run');
		f.state.afterSettle = () => {
			current = false;
			f.state.afterSettle = null;
		};
		resource.firstRelease.resolve();
		assert.equal((await first).status, 'fulfilled');
		await rejected(second.result, 'not_found');
		assert.deepEqual(resource.dispatched, ['/first']);
		assert.deepEqual(resource.applied, ['/first']);
		assert.deepEqual(f.state.settlements, [false, false]);
		await attachment.release();
		assert.deepEqual(resource.closeEvents, ['lease', 'machine']);
		const independent = await f.files.open(token, 2);
		await f.files.createDirectory(token, independent.id, '/independent');
		assert.deepEqual(f.resources[1].applied, ['/independent']);
	});

	await t.test(
		'a write dispatched before Workspace authority revocation remains unknown and still releases resources',
		async (t) => {
			const f = await fixture(t);
			let current = true;
			const attachment = await f.files.openWorkspace(token, 'authority-workspace', 1, {
				isCurrent: () => current,
			});
			const resource = f.resources[0];
			const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
			await resource.firstEntered.promise;
			current = false;
			resource.firstRelease.resolve();
			await rejected(first, 'operation_unknown');
			assert.deepEqual(resource.applied, ['/first']);
			assert.deepEqual(f.state.settlements, [true]);
			await attachment.release();
			assert.deepEqual(resource.closeEvents, ['lease', 'machine']);
		},
	);

	await t.test(
		'cancelling the middle request cannot release its predecessor or retire a healthy resource',
		async (t) => {
			const f = await fixture(t);
			const attachment = await f.files.openWorkspace(token, 'queue-workspace', 1, workspaceAuthority);
			const resource = f.resources[0];
			const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
			await resource.firstEntered.promise;
			const controller = new AbortController();
			const middle = await queue(f, attachment.id, '/cancelled', controller.signal);
			controller.abort();
			await rejected(middle.result, 'remote_unavailable');
			const third = await queue(f, attachment.id, '/third');
			await f.files.pingWorkspace(token, attachment.id, 'queue-workspace');
			assert.deepEqual(resource.closeEvents, []);
			assert.deepEqual(resource.applied, []);
			resource.firstRelease.resolve();
			assert.equal((await first).status, 'fulfilled');
			assert.equal((await third.result).status, 'fulfilled');
			assert.deepEqual(resource.dispatched, ['/first', '/third']);
			assert.deepEqual(resource.applied, ['/first', '/third']);
			assert.deepEqual(f.state.settlements, [false, false]);
			await f.files.createDirectory(token, attachment.id, '/healthy');
			assert.deepEqual(resource.applied, ['/first', '/third', '/healthy']);
		},
	);

	for (const change of ['session', 'fingerprint']) {
		await t.test(`a queued mutation rechecks ${change} after the preceding confirmed write`, async (t) => {
			const f = await fixture(t);
			const attachment = await f.files.open(token, 1);
			const resource = f.resources[0];
			const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
			await resource.firstEntered.promise;
			const second = await queue(f, attachment.id, '/must-not-run');
			// Change authority only after the actual preceding SQLite claim has settled successfully.
			f.state.afterSettle = () => {
				f.state.afterSettle = null;
				if (change === 'session') {
					f.state.live = false;
				} else {
					f.state.stale = true;
				}
			};
			resource.firstRelease.resolve();
			assert.equal((await first).status, 'fulfilled');
			await rejected(second.result, change === 'session' ? 'unauthenticated' : 'stale_target');
			assert.deepEqual(resource.applied, ['/first']);
			assert.deepEqual(resource.dispatched, ['/first']);
			assert.deepEqual(f.state.settlements, [false, false]);
			assert.deepEqual(resource.closeEvents, []);
			f.state.live = true;
			f.state.stale = false;
			await f.files.createDirectory(token, attachment.id, '/healthy');
			assert.deepEqual(resource.applied, ['/first', '/healthy']);
		});
	}

	await t.test(
		'Workspace close cancels queued writes but retains its reservation through active work and cleanup',
		async (t) => {
			const f = await fixture(t);
			const leaseEntered = f.gate();
			const leaseRelease = f.gate();
			const resource = f.resource(1, {
				lease: async () => {
					leaseEntered.resolve();
					await leaseRelease.promise;
				},
			});
			f.state.open = () => resource.resource;
			const attachment = await f.files.openWorkspace(token, 'closing-workspace', 1, workspaceAuthority);
			const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
			await resource.firstEntered.promise;
			const queued = await queue(f, attachment.id, '/queued');
			const closing = attachment.release();
			assert.strictEqual(attachment.release(), closing);
			let closed = false;
			void closing.then(
				() => {
					closed = true;
				},
				() => undefined,
			);
			await rejected(queued.result, 'remote_unavailable');
			await rejected(
				observe(f.files.openWorkspace(token, 'closing-workspace', 1, workspaceAuthority)),
				'conflict',
			);
			await rejected(observe(f.files.createDirectory(token, attachment.id, '/late')), 'not_found');
			assert.deepEqual(resource.closeEvents, []);
			assert.equal(closed, false);
			resource.firstRelease.resolve();
			await rejected(first, 'operation_unknown');
			await leaseEntered.promise;
			assert.equal(closed, false);
			await rejected(
				observe(f.files.openWorkspace(token, 'closing-workspace', 1, workspaceAuthority)),
				'conflict',
			);
			leaseRelease.resolve();
			await closing;
			assert.deepEqual(resource.closeEvents, ['lease', 'machine']);
			assert.deepEqual(resource.applied, ['/first']);
			assert.deepEqual(f.state.settlements, [true]);
			f.state.open = null;
			const reopened = await f.files.openWorkspace(token, 'closing-workspace', 1, workspaceAuthority);
			await f.files.pingWorkspace(token, reopened.id, 'closing-workspace');
			await rejected(observe(f.files.createDirectory(token, reopened.id, '/fenced')), 'conflict');
		},
	);

	await t.test(
		'quiesce promptly rejects queued work and shutdown still waits for the dispatched mutation',
		async (t) => {
			const f = await fixture(t);
			const attachment = await f.files.open(token, 1);
			const resource = f.resources[0];
			const first = observe(f.files.createDirectory(token, attachment.id, '/first'));
			await resource.firstEntered.promise;
			const queued = await queue(f, attachment.id, '/queued');
			f.files.quiesce();
			await rejected(queued.result, 'remote_unavailable');
			await rejected(observe(f.files.open(token, 2)), 'remote_unavailable');
			const closing = f.files.close();
			assert.strictEqual(f.files.close(), closing);
			let closed = false;
			void closing.then(
				() => {
					closed = true;
				},
				() => undefined,
			);
			await turn();
			assert.equal(closed, false);
			assert.deepEqual(resource.closeEvents, []);
			resource.firstRelease.resolve();
			await rejected(first, 'operation_unknown');
			await closing;
			assert.deepEqual(resource.dispatched, ['/first']);
			assert.deepEqual(resource.applied, ['/first']);
			assert.deepEqual(resource.closeEvents, ['lease', 'machine']);
			assert.deepEqual(f.state.settlements, [true]);
		},
	);

	await t.test(
		'a cancelled late Workspace open holds the 64th slot until lease and machine cleanup both finish',
		async (t) => {
			const f = await fixture(t);
			const openingEntered = f.gate();
			const opening = f.gate();
			const leaseEntered = f.gate();
			const leaseRelease = f.gate();
			const machineEntered = f.gate();
			const machineRelease = f.gate();
			const late = f.resource(1, {
				lease: async () => {
					leaseEntered.resolve();
					await leaseRelease.promise;
				},

				machine: async () => {
					machineEntered.resolve();
					await machineRelease.promise;
				},
			});
			f.state.open = (targetId) => {
				if (targetId === 1) {
					openingEntered.resolve();
					return opening.promise;
				}
				return f.resource(targetId).resource;
			};
			const controller = new AbortController();
			const cancelled = observe(
				f.files.openWorkspace(token, 'late-workspace', 1, workspaceAuthority, controller.signal),
			);
			await openingEntered.promise;
			controller.abort();
			await rejected(cancelled, 'remote_unavailable');
			for (let index = 0; index < 63; index += 1) {
				await f.files.openWorkspace(token, `healthy-workspace-${index}`, index + 2, workspaceAuthority);
			}

			const reserved = async () => {
				await rejected(
					observe(f.files.openWorkspace(token, 'late-workspace', 1, workspaceAuthority)),
					'conflict',
				);
				await rejected(
					observe(f.files.openWorkspace(token, 'overflow-workspace', 100, workspaceAuthority)),
					'limit_exceeded',
				);
			};

			await reserved();
			opening.resolve(late.resource);
			await leaseEntered.promise;
			await reserved();
			leaseRelease.resolve();
			await machineEntered.promise;
			await reserved();
			machineRelease.resolve();
			await turn();
			f.state.open = null;
			const replacement = await f.files.openWorkspace(token, 'late-workspace', 1, workspaceAuthority);
			await f.files.pingWorkspace(token, replacement.id, 'late-workspace');
			await rejected(
				observe(f.files.openWorkspace(token, 'overflow-workspace', 100, workspaceAuthority)),
				'limit_exceeded',
			);
			assert.deepEqual(late.closeEvents, ['lease', 'machine']);
		},
	);

	await t.test('failed late cleanup retains Workspace identity, quota and all original cleanup causes', async (t) => {
		const f = await fixture(t);
		const openingEntered = f.gate();
		const opening = f.gate();
		const errors = [new Error('controlled lease cleanup failure'), new Error('controlled machine cleanup failure')];
		const late = f.resource(1, {
			lease: async () => {
				throw errors[0];
			},

			machine: async () => {
				throw errors[1];
			},
		});
		f.state.open = () => {
			openingEntered.resolve();
			return opening.promise;
		};
		const controller = new AbortController();
		const cancelled = observe(
			f.files.openWorkspace(token, 'failed-workspace', 1, workspaceAuthority, controller.signal),
		);
		await openingEntered.promise;
		controller.abort();
		await rejected(cancelled, 'remote_unavailable');
		opening.resolve(late.resource);
		await turn();
		await rejected(observe(f.files.openWorkspace(token, 'failed-workspace', 1, workspaceAuthority)), 'conflict');
		assert.deepEqual(late.closeEvents, ['lease', 'machine']);
		f.state.open = null;
		const healthy = [];
		for (let index = 0; index < 63; index += 1) {
			healthy.push(
				await f.files.openWorkspace(token, `healthy-workspace-${index}`, index + 2, workspaceAuthority),
			);
		}
		await rejected(
			observe(f.files.openWorkspace(token, 'overflow-workspace', 100, workspaceAuthority)),
			'limit_exceeded',
		);
		await healthy[0].release();
		const replacement = await f.files.openWorkspace(token, 'replacement-workspace', 100, workspaceAuthority);
		await f.files.createDirectory(token, replacement.id, '/healthy');
		await rejected(observe(f.files.openWorkspace(token, 'failed-workspace', 1, workspaceAuthority)), 'conflict');
		const shutdown = await observe(f.files.close());
		assert.equal(shutdown.status, 'rejected');
		assert.ok(shutdown.error instanceof AggregateError);
		assert.equal(shutdown.error.errors.length, 1);
		const cleanup = shutdown.error.errors[0];
		assert.ok(cleanup instanceof RemoteResourceCleanupFailure);
		assert.deepEqual(cleanup.errors, errors);
		f.state.expectedShutdownFailure = shutdown.error;
	});

	await t.test(
		'shutdown tracks a cancelled open through late resource arrival and both cleanup stages',
		async (t) => {
			const f = await fixture(t);
			const openingEntered = f.gate();
			const opening = f.gate();
			const leaseEntered = f.gate();
			const leaseRelease = f.gate();
			const machineEntered = f.gate();
			const machineRelease = f.gate();
			const late = f.resource(1, {
				lease: async () => {
					leaseEntered.resolve();
					await leaseRelease.promise;
				},

				machine: async () => {
					machineEntered.resolve();
					await machineRelease.promise;
				},
			});
			f.state.open = () => {
				openingEntered.resolve();
				return opening.promise;
			};
			const controller = new AbortController();
			const cancelled = observe(
				f.files.openWorkspace(token, 'shutdown-workspace', 1, workspaceAuthority, controller.signal),
			);
			await openingEntered.promise;
			controller.abort();
			await rejected(cancelled, 'remote_unavailable');
			let closed = false;
			const closing = f.files.close();
			void closing.then(
				() => {
					closed = true;
				},
				() => undefined,
			);
			await turn();
			assert.equal(closed, false);
			opening.resolve(late.resource);
			await leaseEntered.promise;
			assert.equal(closed, false);
			leaseRelease.resolve();
			await machineEntered.promise;
			assert.equal(closed, false);
			machineRelease.resolve();
			await closing;
			assert.equal(closed, true);
			assert.deepEqual(late.closeEvents, ['lease', 'machine']);
		},
	);

	for (const boundary of ['authentication', 'catalog']) {
		await t.test(
			`quiesce during ${boundary} prevents a late successful admission from opening resources`,
			async (t) => {
				const f = await fixture(t);
				const entered = f.gate();
				const pending = f.gate();

				const blocked = () => {
					entered.resolve();
					return pending.promise;
				};

				if (boundary === 'authentication') {
					f.state.authenticate = blocked;
				} else {
					f.state.catalog = blocked;
				}
				const opening = observe(f.files.openWorkspace(token, 'authorizing-workspace', 1, workspaceAuthority));
				await entered.promise;
				f.files.quiesce();
				await rejected(opening, 'remote_unavailable');
				await f.files.close();
				pending.resolve(boundary === 'authentication' ? { userId: 1 } : { name: 'Late catalog result' });
				await turn();
				assert.equal(f.resources.length, 0);
				await rejected(
					observe(f.files.openWorkspace(token, 'authorizing-workspace', 1, workspaceAuthority)),
					'remote_unavailable',
				);
			},
		);
	}
});

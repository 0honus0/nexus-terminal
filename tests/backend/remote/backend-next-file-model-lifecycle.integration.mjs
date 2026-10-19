import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RemoteFileModel } from '../../../packages/backend/dist/modules/remote/files/model/file-model.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';

function fixture({ openSftp, closeLease, closeMachine, openMachine } = {}) {
	const calls = [];
	const lease = {
		close: () => {
			calls.push('lease.close');
			return closeLease ? closeLease() : Promise.resolve();
		},
	};
	const machine = {
		isOpen: true,

		openSftp: async (signal) => {
			calls.push('sftp.open');
			return openSftp ? openSftp(signal, lease) : lease;
		},

		close: () => {
			calls.push('machine.close');
			return closeMachine ? closeMachine() : Promise.resolve();
		},
	};
	const model = new RemoteFileModel({
		open: async () => {
			calls.push('machine.open');
			await openMachine?.();
			return { machine, target: { id: 17, fingerprint: 'fixture-fingerprint' } };
		},
	});
	return { model, calls };
}

function unavailable(cause) {
	return (error) => {
		assert.ok(error instanceof RemoteFileFailure);
		assert.equal(error.code, 'remote_unavailable');
		assert.strictEqual(error.cause, cause);
		return true;
	};
}

test('cancelled machine acquisition closes its late result without opening SFTP', async (t) => {
	const entered = Promise.withResolvers();
	const delivery = Promise.withResolvers();
	t.after(() => delivery.resolve());
	const { model, calls } = fixture({
		openMachine: () => {
			entered.resolve();
			return delivery.promise;
		},
	});
	const controller = new AbortController();
	const reason = new Error('request cancelled');
	const rejected = assert.rejects(model.open(17, 1000, controller.signal), unavailable(reason));
	await entered.promise;
	controller.abort(reason);
	delivery.resolve();
	await rejected;
	assert.deepEqual(calls, ['machine.open', 'machine.close']);
});

test('late SFTP cancellation waits for lease and machine cleanup before settling', async (t) => {
	const entered = Promise.withResolvers();
	const delivery = Promise.withResolvers();
	const closing = Promise.withResolvers();
	const closed = Promise.withResolvers();
	t.after(() => {
		delivery.resolve();
		closed.resolve();
	});
	const { model, calls } = fixture({
		openSftp: async (_signal, lease) => {
			entered.resolve();
			await delivery.promise;
			return lease;
		},

		closeLease: () => {
			closing.resolve();
			return closed.promise;
		},
	});
	const controller = new AbortController();
	const reason = new Error('cancel during SFTP acquisition');
	let settled = false;
	const rejected = assert.rejects(model.open(17, 1000, controller.signal), unavailable(reason));
	void rejected.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	await entered.promise;
	controller.abort(reason);
	delivery.resolve();
	await closing.promise;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false, 'request must retain ownership until cleanup settles');
	assert.deepEqual(calls, ['machine.open', 'sftp.open', 'lease.close']);
	closed.resolve();
	await rejected;
	assert.deepEqual(calls, ['machine.open', 'sftp.open', 'lease.close', 'machine.close']);
});

test('SFTP rejection racing cancellation retains the actual acquisition failure', async (t) => {
	const entered = Promise.withResolvers();
	const delivery = Promise.withResolvers();
	t.after(() => delivery.resolve());
	const failure = new Error('SFTP acquisition failed');
	const { model, calls } = fixture({
		openSftp: async () => {
			entered.resolve();
			await delivery.promise;
			throw failure;
		},
	});
	const controller = new AbortController();
	const rejected = assert.rejects(model.open(17, 1000, controller.signal), unavailable(failure));
	await entered.promise;
	controller.abort(new Error('independent cancellation'));
	delivery.resolve();
	await rejected;
	assert.deepEqual(calls, ['machine.open', 'sftp.open', 'machine.close']);
});

test('cancelled SFTP delivery preserves both synchronous cleanup failures', async () => {
	const controller = new AbortController();
	const cancellation = new Error('cancel before delivery');
	const leaseFailure = new Error('lease close failed');
	const machineFailure = new Error('machine close failed');
	const { model, calls } = fixture({
		openSftp: (_signal, lease) => {
			controller.abort(cancellation);
			return lease;
		},

		closeLease: () => {
			throw leaseFailure;
		},

		closeMachine: () => {
			throw machineFailure;
		},
	});
	await assert.rejects(model.open(17, 1000, controller.signal), (error) => {
		assert.ok(error instanceof RemoteResourceCleanupFailure);
		assert.equal(error.errors.length, 3);
		unavailable(cancellation)(error.errors[0]);
		assert.strictEqual(error.errors[1], leaseFailure);
		assert.strictEqual(error.errors[2], machineFailure);
		return true;
	});
	assert.deepEqual(calls, ['machine.open', 'sftp.open', 'lease.close', 'machine.close']);
});

test('failed SFTP acquisition and asynchronous machine cleanup preserve both causes', async () => {
	const acquisition = new Error('SFTP failed');
	const cleanup = new Error('machine cleanup failed');
	const { model, calls } = fixture({
		openSftp: async () => {
			throw acquisition;
		},

		closeMachine: () => Promise.reject(cleanup),
	});
	await assert.rejects(model.open(17, 1000, new AbortController().signal), (error) => {
		assert.ok(error instanceof RemoteResourceCleanupFailure);
		assert.equal(error.errors.length, 2);
		unavailable(acquisition)(error.errors[0]);
		assert.strictEqual(error.errors[1], cleanup);
		return true;
	});
	assert.deepEqual(calls, ['machine.open', 'sftp.open', 'machine.close']);
});

test('machine acquisition rejection is mapped without assuming ownership of an undelivered machine', async () => {
	const failure = new Error('machine owner rejected acquisition');
	const { model, calls } = fixture({
		openMachine: () => Promise.reject(failure),
	});
	await assert.rejects(model.open(17, 1000, new AbortController().signal), unavailable(failure));
	assert.deepEqual(calls, ['machine.open']);
});

test('failed cancelled acquisition leaves an independent healthy resource usable and closes it once', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled independent acquisition');
	const failed = fixture({
		openSftp: (_signal, lease) => {
			controller.abort(reason);
			return lease;
		},
	});
	const healthy = fixture();
	const resource = await healthy.model.open(17, 1000, new AbortController().signal);
	await assert.rejects(failed.model.open(17, 1000, controller.signal), unavailable(reason));
	assert.equal(resource.targetId, 17);
	assert.equal(resource.fingerprint, 'fixture-fingerprint');
	assert.equal(resource.isOpen, true);
	assert.deepEqual(healthy.calls, ['machine.open', 'sftp.open']);
	const first = resource.close();
	assert.strictEqual(resource.close(), first);
	await first;
	assert.equal(resource.isOpen, false);
	assert.deepEqual(healthy.calls, ['machine.open', 'sftp.open', 'lease.close', 'machine.close']);
});

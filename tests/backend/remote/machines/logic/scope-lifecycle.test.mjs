import assert from 'node:assert/strict';
import { test } from 'vitest';
import { RemoteMachineScopeModel } from '../../../../../packages/backend/src/modules/remote/machines/model/machine-scope-model.ts';
import { RemoteResourceCleanupFailure } from '../../../../../packages/backend/src/modules/remote/resource-errors.ts';

const targetFingerprint = 'a'.repeat(64);
const publicKey = Buffer.from('scope-owned-host-key');

test('Agent reuse: a cancelled handshake retains and closes its late result during scope drain', async (t) => {
	const entered = Promise.withResolvers();
	const delivered = Promise.withResolvers();
	let closed = 0;
	const pool = new RemoteMachineScopeModel({
		reuseKey: async () => 'fixture',

		open: async () => {
			entered.resolve();
			return delivered.promise;
		},
	});
	t.onTestFinished(async () => {
		delivered.resolve({
			target: { id: 1, fingerprint: targetFingerprint },
			hostPublicKey: publicKey,
			machine: {
				isOpen: true,

				close: async () => {
					closed++;
				},
			},
		});
		await pool.close();
	});
	const stop = new AbortController();
	const pending = assert.rejects(pool.open({ targetId: 1, timeoutMs: 10000, signal: stop.signal }));
	await entered.promise;
	stop.abort();
	await pending;
	let drained = false;
	const closing = pool.close();
	void closing.then(() => {
		drained = true;
	});
	assert.strictEqual(pool.close(), closing);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(drained, false);
	delivered.resolve({
		target: { id: 1, fingerprint: targetFingerprint },
		hostPublicKey: publicKey,
		machine: {
			isOpen: true,

			close: async () => {
				closed++;
			},
		},
	});
	await closing;
	assert.equal(closed, 1);
});

test('Agent reuse: failed cleanup retains all causes and still closes other connections', async () => {
	let opened = 0;
	let closed = 0;
	const failure = new Error('controlled close failure');
	const pool = new RemoteMachineScopeModel({
		reuseKey: async (request) => String(request.targetId),

		open: async () => {
			const first = opened++ === 0;
			return {
				target: { id: 1, fingerprint: targetFingerprint },
				hostPublicKey: publicKey,
				machine: {
					isOpen: true,

					close: async () => {
						closed++;
						if (first) throw failure;
					},
				},
			};
		},
	});
	const request = { targetId: 1, timeoutMs: 10000, signal: new AbortController().signal };
	const a = await pool.open(request);
	const b = await pool.open({ ...request, targetId: 2 });
	await pool.release(a.machine, true);
	await pool.release(b.machine, true);
	await assert.rejects(
		pool.close(),
		(error) =>
			error instanceof RemoteResourceCleanupFailure &&
			error.errors.some(
				(cause) => cause instanceof RemoteResourceCleanupFailure && cause.errors.includes(failure),
			),
	);
	assert.equal(closed, 2);
	await assert.rejects(pool.open(request));
});

test('Agent reuse: retiring a changed target does not close another in-flight borrow', async () => {
	let key = 'old';
	const closes = [];
	const pool = new RemoteMachineScopeModel({
		reuseKey: async () => key,

		open: async () => {
			const identity = key;
			return {
				target: { id: 1, fingerprint: identity },
				hostPublicKey: publicKey,
				machine: {
					isOpen: true,

					close: async () => {
						closes.push(identity);
					},
				},
			};
		},
	});
	try {
		const request = { targetId: 1, timeoutMs: 10000, signal: new AbortController().signal };
		const old = await pool.open(request);
		key = 'new';
		const next = await pool.open(request);
		assert.deepEqual(closes, [], 'retirement does not interrupt an in-flight operation');
		await pool.release(old.machine, true);
		assert.deepEqual(closes, ['old']);
		assert.equal(next.machine.isOpen, true);
		await pool.release(next.machine, true);
	} finally {
		await pool.close();
	}
	assert.deepEqual(closes, ['old', 'new']);
});

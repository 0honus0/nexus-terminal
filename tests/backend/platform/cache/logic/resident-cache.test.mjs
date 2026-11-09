import { test, expect, vi, onTestFinished } from 'vitest';
import {
	ResidentCache,
	ResidentCacheClosed,
} from '../../../../../packages/backend/dist/platform/cache/resident-cache.js';

for (const value of [null, false, undefined, { label: 'Pocket ID' }]) {
	test(`resident cache shares concurrent loads and retains ${String(value)}`, async () => {
		const gate = Promise.withResolvers();
		const load = vi.fn(() => gate.promise);
		const cache = new ResidentCache(load);
		onTestFinished(() => cache.close());
		const reads = Array.from({ length: 10 }, () => cache.read());
		gate.resolve(value);
		expect(await Promise.all(reads)).toEqual(Array(10).fill(value));
		expect(await cache.read()).toEqual(value);
		expect(load).toHaveBeenCalledTimes(1);
	});
}

test.each(['success', 'failure'])('invalidation discards late %s and redirects existing readers', async (outcome) => {
	const first = Promise.withResolvers();
	const started = Promise.withResolvers();
	let calls = 0;
	let signal;
	const cache = new ResidentCache(async (currentSignal) => {
		calls++;
		if (calls === 1) {
			signal = currentSignal;
			started.resolve();
			return first.promise;
		}
		return 'current';
	});
	onTestFinished(() => cache.close());
	const original = cache.read();
	await started.promise;
	cache.invalidate();
	expect(signal.aborted).toBe(true);
	expect(await cache.read()).toBe('current');
	if (outcome === 'success') {
		first.resolve('obsolete');
	} else {
		first.reject(new Error('obsolete failure'));
	}
	expect(await original).toBe('current');
	expect(await cache.read()).toBe('current');
	expect(calls).toBe(2);
});

test('failed loads are shared, evicted and recover on the next read', async () => {
	const failure = new Error('read failed');
	const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('recovered');
	const cache = new ResidentCache(load);
	onTestFinished(() => cache.close());
	const results = await Promise.allSettled([cache.read(), cache.read()]);
	expect(results).toEqual([
		{ status: 'rejected', reason: failure },
		{ status: 'rejected', reason: failure },
	]);
	expect(await cache.read()).toBe('recovered');
	expect(load).toHaveBeenCalledTimes(2);
});

test('close is shared, cancels admission, drains uncancellable work and prevents repopulation', async () => {
	const gate = Promise.withResolvers();
	const started = Promise.withResolvers();
	const load = vi.fn(async (signal) => {
		started.resolve(signal);
		return gate.promise;
	});
	const cache = new ResidentCache(load);
	const result = cache.read().catch((error) => error);
	const signal = await started.promise;
	let reentered;
	signal.addEventListener(
		'abort',
		() => {
			reentered = cache.close();
		},
		{ once: true },
	);
	let closed = false;
	const closing = cache.close();
	expect(cache.close()).toBe(closing);
	expect(reentered).toBe(closing);
	void closing.then(() => {
		closed = true;
	});
	expect(signal.aborted).toBe(true);
	expect(await result).toBeInstanceOf(ResidentCacheClosed);
	expect(closed).toBe(false);
	await expect(cache.read()).rejects.toBeInstanceOf(ResidentCacheClosed);
	gate.resolve('late');
	await closing;
	expect(closed).toBe(true);
	cache.invalidate();
	await expect(cache.read()).rejects.toBeInstanceOf(ResidentCacheClosed);
	expect(load).toHaveBeenCalledTimes(1);
});

test('close also drains an invalidated loader after its replacement has already completed', async () => {
	const gate = Promise.withResolvers();
	const started = Promise.withResolvers();
	const load = vi
		.fn()
		.mockImplementationOnce(() => {
			started.resolve();
			return gate.promise;
		})
		.mockResolvedValue('current');
	const cache = new ResidentCache(load);
	const reading = cache.read();
	await started.promise;
	cache.invalidate();
	expect(await reading).toBe('current');
	let closed = false;
	const closing = cache.close().then(() => {
		closed = true;
	});
	await expect(cache.read()).rejects.toBeInstanceOf(ResidentCacheClosed);
	expect(closed).toBe(false);
	gate.resolve('obsolete');
	await closing;
	expect(closed).toBe(true);
	expect(load).toHaveBeenCalledTimes(2);
});

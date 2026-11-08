import assert from 'node:assert/strict';
import { test, vi, beforeEach, afterEach } from 'vitest';
import { DesktopService } from '../../../../../packages/backend/src/modules/remote/desktop/service/desktop-service.ts';
import { DesktopModel } from '../../../../../packages/backend/src/modules/remote/desktop/model/desktop-model.ts';
import { SecureSessionTokens } from '../../../../../packages/backend/src/platform/security/adapters/secure-session-tokens.ts';
import { DesktopFailure } from '../../../../../packages/backend/src/modules/remote/desktop/desktop-errors.ts';
let cleanup = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
	const failures = [];
	try {
		for (const close of cleanup.reverse()) {
			try {
				await close();
			} catch (error) {
				failures.push(error);
			}
		}
		assert.equal(vi.getTimerCount(), 0, 'Desktop owner releases all timers');
	} finally {
		cleanup = [];
		vi.useRealTimers();
	}
	if (failures.length) throw new AggregateError(failures, 'Desktop owner fixture cleanup failed');
});

const display = { width: null, height: null, dpi: null };

function gate() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture() {
	const tokens = new SecureSessionTokens();
	const state = { get: null, reads: 0, completed: 0, attempts: 0, issued: 0 };
	const owner = new DesktopService(
		{ authenticate: async () => ({ userId: 1 }) },
		{
			async get() {
				state.reads++;
				await state.get?.();
				state.completed++;
				return {
					id: 1,
					version: 1,
					createdAt: 1,
					protocol: 'VNC',
					host: 'desktop.local',
					port: 3389,
					username: 'isolated-user',
					password: 'isolated-password',
				};
			},
		},
		new DesktopModel(
			{},
			{
				issue() {
					state.issued++;
					return tokens.issue();
				},

				digest: (value) => tokens.digest(value),
			},
			{},
		),
		{
			async recordConnected() {
				state.attempts++;
			},
		},
	);
	cleanup.push(() => owner.close());
	return { owner, state };
}

test('Desktop pending capacity includes in-flight and cancelled-but-unsettled reservations', async () => {
	const { owner, state } = fixture();
	const release = gate();
	cleanup.push(() => release.resolve());
	state.get = () => release.promise;
	const cancellation = new AbortController();
	const requests = Array.from({ length: 1024 }, (_, index) =>
		owner.issue('session', 1, 'VNC', display, index === 0 ? cancellation.signal : undefined),
	);
	const completed = Promise.allSettled(requests);
	await vi.waitFor(() => assert.equal(state.reads, 1024));
	await assert.rejects(
		owner.issue('session', 1, 'VNC', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
	cancellation.abort();
	await assert.rejects(
		requests[0],
		(error) => error instanceof DesktopFailure && error.code === 'remote_unavailable',
	);
	await assert.rejects(
		owner.issue('session', 1, 'VNC', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
	release.resolve();
	const results = await completed;
	assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
	assert.equal(
		new Set(results.filter((result) => result.status === 'fulfilled').map((result) => result.value.ticket)).size,
		1023,
	);
	assert.equal(state.attempts, 0);
	await owner.issue('session', 1, 'VNC', display);
	assert.equal(state.issued, 1024);
	await assert.rejects(
		owner.issue('session', 1, 'VNC', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
});

test('Desktop original 15-second issue deadline fences late Targets completion without issuing a ticket', async () => {
	const { owner, state } = fixture();
	const release = gate();
	cleanup.push(() => release.resolve());
	state.get = () => release.promise;
	let settled = false;
	const issuing = owner.issue('session', 1, 'VNC', display).finally(() => {
		settled = true;
	});
	const rejected = assert.rejects(
		issuing,
		(error) => error instanceof DesktopFailure && error.code === 'remote_unavailable',
	);
	await vi.advanceTimersByTimeAsync(14999);
	assert.equal(settled, false, 'Original issue deadline must not fire early');
	await vi.advanceTimersByTimeAsync(1);
	await rejected;
	assert.equal(state.attempts, 0);
	assert.equal(state.issued, 0);
	release.resolve();
	await vi.waitFor(() => assert.equal(state.completed, 1));
	state.get = null;
	await owner.issue('session', 1, 'VNC', display);
	assert.equal(state.attempts, 0);
	assert.equal(state.issued, 1);
});

test('Desktop original 30-second handshake deadline closes its peer and awaits late technical termination', async () => {
	const { owner } = fixture();
	const issued = await owner.issue('session', 1, 'VNC', display);
	const release = gate();
	const disconnected = gate();
	const opened = gate();
	const listeners = [];
	let settled = false;
	let terminations = 0;
	const peer = {
		isOpen: true,
		isClosed: false,

		onClosed(listener) {
			listeners.push(listener);
		},

		requestClose() {
			this.disconnect();
		},

		disconnect() {
			if (this.isClosed) return;
			this.isOpen = false;
			this.isClosed = true;
			for (const listener of listeners.splice(0)) listener();
			disconnected.resolve();
		},

		async waitClosed() {
			await disconnected.promise;
		},

		async open(_connection, _display, terminated) {
			opened.resolve();
			await release.promise;
			terminations++;
			terminated();
		},
	};
	const accepting = owner.accept('session', issued.ticket, peer);
	const observed = accepting.then(() => {
		settled = true;
	});
	cleanup.push(async () => {
		release.resolve();
		await observed;
	});
	await opened.promise;
	await vi.advanceTimersByTimeAsync(29999);
	assert.equal(peer.isClosed, false, 'Original handshake deadline must not fire early');
	await vi.advanceTimersByTimeAsync(1);
	await disconnected.promise;
	assert.equal(settled, false);
	assert.equal(terminations, 0);
	release.resolve();
	await observed;
	assert.equal(terminations, 1);
	assert.equal(settled, true);
	await owner.close();
});

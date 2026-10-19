import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopService } from '../../../packages/backend/dist/modules/remote/desktop/service/desktop-service.js';
import { DesktopModel } from '../../../packages/backend/dist/modules/remote/desktop/model/desktop-model.js';
import { SecureSessionTokens } from '../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';
import { DesktopFailure } from '../../../packages/backend/dist/modules/remote/desktop/desktop-errors.js';
import { until } from './openssh-fixture.mjs';

const display = { width: null, height: null, dpi: null };

function gate() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture(t) {
	// Controlled peers have no actual socket to keep Node alive during the original unref'ed deadlines.
	const transportLoop = setInterval(() => undefined, 1000);
	t.after(() => clearInterval(transportLoop));
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
					protocol: 'rdp',
					host: 'desktop.local',
					port: 3389,
					username: 'isolated-user',
					password: 'isolated-password',
					rdpRemoteApp: null,
					rdpRemoteAppDirectory: null,
					rdpRemoteAppArguments: null,
				};
			},

			async markAttempt() {
				state.attempts++;
				return true;
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
		),
	);
	t.after(() => owner.close());
	return { owner, state };
}

await test('Desktop pending capacity includes in-flight and cancelled-but-unsettled reservations', async (t) => {
	const { owner, state } = fixture(t);
	const release = gate();
	t.after(() => release.resolve());
	state.get = () => release.promise;
	const cancellation = new AbortController();
	const requests = Array.from({ length: 1024 }, (_, index) =>
		owner.issue('session', 1, 'rdp', display, index === 0 ? cancellation.signal : undefined),
	);
	const completed = Promise.allSettled(requests);
	await until(
		() => state.reads,
		(value) => value === 1024,
		'all real owner reservations waiting',
	);
	await assert.rejects(
		owner.issue('session', 1, 'rdp', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
	cancellation.abort();
	await assert.rejects(
		requests[0],
		(error) => error instanceof DesktopFailure && error.code === 'remote_unavailable',
	);
	await assert.rejects(
		owner.issue('session', 1, 'rdp', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
	release.resolve();
	const results = await completed;
	assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
	assert.equal(
		new Set(results.filter((result) => result.status === 'fulfilled').map((result) => result.value.ticket)).size,
		1023,
	);
	assert.equal(state.attempts, 1023);
	await owner.issue('session', 1, 'rdp', display);
	assert.equal(state.issued, 1024);
	await assert.rejects(
		owner.issue('session', 1, 'rdp', display),
		(error) => error instanceof DesktopFailure && error.code === 'limit_exceeded',
	);
});

await test('Desktop original 15-second issue deadline fences late Targets completion without issuing a ticket', async (t) => {
	const { owner, state } = fixture(t);
	const release = gate();
	t.after(() => release.resolve());
	state.get = () => release.promise;
	const started = performance.now();
	await assert.rejects(
		owner.issue('session', 1, 'rdp', display),
		(error) => error instanceof DesktopFailure && error.code === 'remote_unavailable',
	);
	assert.ok(performance.now() - started >= 14900);
	assert.equal(state.attempts, 0);
	assert.equal(state.issued, 0);
	release.resolve();
	await until(
		() => state.completed,
		(value) => value === 1,
		'late target read really settles',
	);
	state.get = null;
	await owner.issue('session', 1, 'rdp', display);
	assert.equal(state.attempts, 1);
	assert.equal(state.issued, 1);
});

await test('Desktop original 30-second handshake deadline closes its peer and awaits late technical termination', async (t) => {
	const { owner } = fixture(t);
	const issued = await owner.issue('session', 1, 'rdp', display);
	const release = gate();
	const disconnected = gate();
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
			await release.promise;
			terminations++;
			terminated();
		},
	};
	const started = performance.now();
	const accepting = owner.accept('session', issued.ticket, peer);
	const observed = accepting.then(() => {
		settled = true;
	});
	t.after(async () => {
		release.resolve();
		await observed;
	});
	await disconnected.promise;
	assert.ok(performance.now() - started >= 29900);
	assert.equal(settled, false);
	assert.equal(terminations, 0);
	release.resolve();
	await observed;
	assert.equal(terminations, 1);
	assert.equal(settled, true);
	await owner.close();
});

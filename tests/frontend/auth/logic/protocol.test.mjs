// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { createPinia } from 'pinia';
import { requestJson } from '../../../../packages/frontend/src/client/http/json-client.ts';
import { HttpRequestFailure } from '../../../../packages/frontend/src/client/http/request-failure.ts';
import { AuthRequestFailure } from '../../../../packages/frontend/src/features/auth/model/auth-failure.ts';

test('authentication strictly decodes faults, cancels bodies and fences unknown or late authority', async () => {
	const api = createAccessApi();
	const store = useAuthStore(createPinia());
	const checks = [];

	function check(value, name) {
		expect(value, name).toBeTruthy();
		checks.push(name);
	}

	const fetchOriginal = globalThis.fetch;

	const json = (body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

	try {
		globalThis.fetch = async () => json({ requiresTwoFactor: true });
		check(
			(await store.login({ username: 'admin', password: 'fixture-password-123' })).status ===
				'two-factor-required' && store.pendingSecondFactor,
			'pending TOTP is not login',
		);
		globalThis.fetch = async () => json({ user: { id: 1, username: 'admin', twoFactorEnabled: true } });
		await store.verifyTwoFactor('123456');
		check(store.sessionState === 'authenticated' && !store.pendingSecondFactor, 'TOTP success projection');
		globalThis.fetch = async () => {
			throw Error('private transport detail');
		};
		check((await store.resolveSession(true)) === 'unknown' && store.user === null, 'network probe remains unknown');
		check((await store.resolveSetupState(true)) === 'unknown', 'setup probe remains unknown');
		let finish;
		globalThis.fetch = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const stale = store.login({ username: 'admin', password: 'fixture-password-123' }).catch((cause) => cause);
		store.invalidateSession();
		finish(json({ requiresTwoFactor: false, user: { id: 1, username: 'old', twoFactorEnabled: false } }));
		check(
			(await stale) instanceof AuthRequestFailure && store.user === null && store.sessionState === 'anonymous',
			'late login cannot revive invalid session',
		);
		let cancelled = false;
		globalThis.fetch = async () =>
			new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { 'Content-Type': 'text/plain' } },
			);
		const malformed = await api.status().catch((cause) => cause);
		check(
			malformed instanceof AuthRequestFailure && malformed.code === 'protocol_failure' && cancelled,
			'early body rejection cancels stream',
		);
		globalThis.fetch = async () =>
			json({
				isAuthenticated: true,
				user: { id: 1, username: 'admin', twoFactorEnabled: false, privateToken: 'secret' },
			});
		check((await api.status().catch((cause) => cause)).code === 'protocol_failure', 'private wire fields rejected');
		globalThis.fetch = async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(5));
					},

					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { 'Content-Type': 'application/json' } },
			);
		cancelled = false;
		const overflow = await requestJson({
			method: 'GET',
			url: '/api/v1/auth/status',
			maxRequestBytes: 4,
			maxResponseBytes: 4,
		}).catch((cause) => cause);
		check(
			overflow instanceof HttpRequestFailure && overflow.outcome === 'unknown' && cancelled,
			'stream budget and cleanup',
		);
		let dispatched = 0;
		globalThis.fetch = async () => {
			dispatched++;
			return json({});
		};
		const abort = new AbortController();
		abort.abort();
		const stopped = await requestJson({
			method: 'GET',
			url: '/api/v1/auth/status',
			signal: abort.signal,
			maxRequestBytes: 4,
			maxResponseBytes: 4,
		}).catch((cause) => cause);
		check(
			stopped.code === 'cancelled' && stopped.outcome === 'not_dispatched' && dispatched === 0,
			'pre-dispatch cancellation',
		);
		globalThis.fetch = async () => json({ code: 'unrecognized' }, 401);
		check((await api.status().catch((cause) => cause)).code === 'protocol_failure', 'unknown 401 is not anonymous');
		dispatched = 0;
		globalThis.fetch = async () => {
			dispatched++;
			return json({});
		};
		const large = await requestJson({
			method: 'POST',
			url: '/api/v1/auth/login',
			body: { text: 'too large' },
			maxRequestBytes: 4,
			maxResponseBytes: 16,
		}).catch((cause) => cause);
		check(
			large.code === 'invalid_input' && large.outcome === 'not_dispatched' && dispatched === 0,
			'request budget before dispatch',
		);
		globalThis.fetch = async () => {
			dispatched++;
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.error(Error('private stream error'));
					},
				}),
				{ headers: { 'Content-Type': 'application/json' } },
			);
		};
		const broken = await api.logout().catch((cause) => cause);
		check(
			broken instanceof AuthRequestFailure && broken.outcome === 'unknown' && dispatched === 1,
			'response failure does not replay logout',
		);
		dispatched = 0;
		globalThis.fetch = async () => {
			dispatched++;
			throw Error('private response failure');
		};
		store.user = { id: 1, username: 'admin', twoFactorEnabled: false };
		store.sessionState = 'authenticated';
		const passwordUnknown = await store
			.changePassword('fixture-password-123', 'changed-password-456')
			.catch((cause) => cause);
		check(
			passwordUnknown instanceof AuthRequestFailure &&
				passwordUnknown.outcome === 'unknown' &&
				store.sessionState === 'unknown' &&
				store.user === null &&
				dispatched === 1,
			'unconfirmed password change clears local authority without replay',
		);
		globalThis.fetch = async () =>
			json({ secret: 'A'.repeat(32), qrCodeUrl: 'https://example.invalid/secret.png' });
		check(
			(await api.beginTotpSetup().catch((cause) => cause)).code === 'protocol_failure',
			'TOTP rejects remote QR source',
		);
		globalThis.fetch = async () => json({ changed: true, secret: 'private' });
		check(
			(await api.activateTotp('123456').catch((cause) => cause)).code === 'protocol_failure',
			'TOTP rejects additional response fields',
		);
		globalThis.fetch = async () => json({ code: 'challenge_expired' }, 410);
		check(
			(await api.activateTotp('123456').catch((cause) => cause)).code === 'challenge_expired',
			'TOTP expiry remains a typed refusal',
		);
	} finally {
		globalThis.fetch = fetchOriginal;
	}
	expect(checks).toHaveLength(16);
});

// @vitest-environment jsdom
import { test, expect } from 'vitest';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { createPinia } from 'pinia';
import { AuthRequestFailure } from '../../../../packages/frontend/src/features/auth/model/auth-failure.ts';

test('Passkey protocol rejects weakened verification and invalid identity without reviving revoked login', async () => {
	const api = createAccessApi();
	const store = useAuthStore(createPinia());
	const checks = [];

	function check(value, name) {
		expect(value, name).toBeTruthy();
		checks.push(name);
	}

	const credential = {
		id: 'AAAA',
		rawId: 'AAAA',
		type: 'public-key',
		response: { clientDataJSON: 'AAAA', attestationObject: 'AAAA', transports: ['internal'] },
		clientExtensionResults: {},
	};
	const original = globalThis.fetch;

	const json = (body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

	try {
		globalThis.fetch = async () => json({ verified: false }, 400);
		const refused = await api.passkeys.register(credential).catch((cause) => cause);
		check(
			refused instanceof AuthRequestFailure &&
				refused.code === 'invalid_credentials' &&
				refused.outcome === 'confirmed',
			'registration false is a typed refusal',
		);
		globalThis.fetch = async () => json({ challenge: 'AAAA', rpId: 'localhost', userVerification: 'preferred' });
		check(
			(await api.passkeys.authenticationOptions('admin').catch((cause) => cause)).code === 'protocol_failure',
			'weakened verification options rejected',
		);
		globalThis.fetch = async () =>
			json([{ credentialId: credential.id, name: null, transports: [], createdAt: 10, lastUsedAt: 9 }]);
		check(
			(await api.passkeys.list().catch((cause) => cause)).code === 'protocol_failure',
			'invalid credential timestamp relation rejected',
		);
		let calls = 0;
		globalThis.fetch = async () => {
			calls++;
			return json({});
		};
		check(
			(await api.passkeys.rename('bad/id', 'name').catch((cause) => cause)).outcome === 'not_dispatched' &&
				calls === 0,
			'invalid credential path rejected before dispatch',
		);
		let finishOptions;
		let optionsSignal;
		globalThis.fetch = (url, options) => {
			calls++;
			optionsSignal = options.signal;
			return new Promise((resolve) => {
				finishOptions = resolve;
			});
		};
		const stale = store.loginWithPasskey({ username: 'admin', rememberMe: true }).catch((cause) => cause);
		store.invalidateSession();
		finishOptions(json({ challenge: 'AAAA', rpId: 'localhost', userVerification: 'required' }));
		const cancelled = await stale;
		check(
			cancelled instanceof AuthRequestFailure &&
				cancelled.code === 'cancelled' &&
				optionsSignal.aborted &&
				calls === 1 &&
				store.sessionState === 'anonymous',
			'session invalidation aborts Passkey owner and prevents late authentication dispatch',
		);
	} finally {
		globalThis.fetch = original;
	}
	expect(checks).toHaveLength(5);
});

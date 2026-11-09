import { test, expect } from 'vitest';
import { openAccess } from '../../auth/support/fixture.mjs';

test('actual security settings retain CAS, secret intents, effective revision and blacklist paging', async () => {
	await openAccess({ password: 'final-password-789' });
	const { createAccessApi } = await import('../../../../packages/frontend/src/features/auth/api/access-api.ts');
	const { configurationApi } =
		await import('../../../../packages/frontend/src/features/preferences/api/configuration-api.ts');
	const { ConfigurationFailure } =
		await import('../../../../packages/frontend/src/features/preferences/model/configuration-types.ts');
	const { ipBlacklistApi } =
		await import('../../../../packages/frontend/src/features/security/api/ip-blacklist-api.ts');
	const api = createAccessApi();
	await api.login({ username: 'admin', password: 'final-password-789' });
	const checks = [];

	function check(value, name) {
		if (!value) {
			throw Error(name);
		}
		checks.push(name);
	}

	const original = await configurationApi.get();
	check(
		original.revision >= 1 && !Object.hasOwn(original.captcha, 'secretKey'),
		'real saved configuration projection excludes secret',
	);
	const network = {
		whitelist: original.network.whitelist,
		blacklistEnabled: original.network.blacklistEnabled,
		maxLoginAttempts: original.network.maxLoginAttempts + 1,
		loginBanDuration: original.network.loginBanDuration,
	};
	const saved = await configurationApi.saveNetwork(original, network);
	check(
		saved.revision === original.revision + 1 &&
			saved.pendingRestart === original.pendingRestart &&
			saved.effectiveRevision === (original.pendingRestart ? original.effectiveRevision : saved.revision),
		'real network CAS and saved versus effective revision',
	);
	check(
		saved.statusIntervalSeconds === original.statusIntervalSeconds &&
			JSON.stringify(saved.passkeySites) === JSON.stringify(original.passkeySites),
		'real network update preserves other configuration owners',
	);
	const conflict = await configurationApi.saveNetwork(original, network).catch((cause) => cause);
	check(
		conflict instanceof ConfigurationFailure &&
			conflict.code === 'version_conflict' &&
			conflict.outcome === 'confirmed',
		'real stale configuration CAS refused',
	);
	const draft = {
		enabled: false,
		provider: 'hcaptcha',
		siteKey: 'fixture-site',
		hostname: 'localhost',
		secretAction: 'replace',
		secretValue: 'private-fixture-secret',
	};
	await configurationApi.saveCaptcha(saved.revision, draft);
	const captchaSaved = await configurationApi.get();
	check(
		captchaSaved.captcha.hasSecret &&
			captchaSaved.captcha.siteKey === draft.siteKey &&
			!Object.hasOwn(captchaSaved.captcha, 'secretValue'),
		'real CAPTCHA secret replace and safe read',
	);
	draft.secretAction = 'keep';
	draft.secretValue = '';
	await configurationApi.saveCaptcha(captchaSaved.revision, draft);
	const kept = await configurationApi.get();
	check(kept.captcha.hasSecret, 'real explicit CAPTCHA secret keep');
	draft.secretAction = 'clear';
	await configurationApi.saveCaptcha(kept.revision, draft);
	check(!(await configurationApi.get()).captcha.hasSecret, 'real explicit CAPTCHA secret clear');
	check((await api.loginOptions()).captcha.provider === 'none', 'real public CAPTCHA remains installation snapshot');
	for (let attempt = 0; attempt < 5; attempt++) {
		await fetch('/api/v1/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.42' },
			body: JSON.stringify({ username: 'admin', password: 'incorrect-password' }),
		});
	}
	const list = await ipBlacklistApi.list(50, 0);
	check(
		list.entries.length > 0 && list.entries[0].lastAttemptAtMs > 1_000_000_000_000,
		'real blacklist pagination and time projection',
	);
	await ipBlacklistApi.remove(list.entries[0].ip);
	check((await ipBlacklistApi.list(50, 0)).entries.length === 0, 'real blacklist collection DELETE JSON request');
	const fetchOriginal = globalThis.fetch;

	const json = (body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

	try {
		globalThis.fetch = async () => json({ code: 'operation_unknown' }, 503);
		check(
			(await configurationApi.saveNetwork(saved, network).catch((cause) => cause)).outcome === 'unknown',
			'configuration unknown remains unknown',
		);
		globalThis.fetch = async () =>
			json({ entries: [{ ip: '127.0.0.1', attempts: 1, lastAttemptAt: 1, blockedUntil: null }], total: 0 });
		check(
			(await ipBlacklistApi.list(50, 0).catch((cause) => cause)).code === 'protocol_failure',
			'blacklist count context mismatch rejected',
		);
	} finally {
		globalThis.fetch = fetchOriginal;
	}
	expect(checks).toHaveLength(12);
});

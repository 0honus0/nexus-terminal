import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import baseline from '../../../fixtures/data/preferences/monitoring-settings.json' with { type: 'json' };
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
afterEach(() => vi.unstubAllGlobals());

test('monitoring settings preserve actual HTTP CAS, unrelated settings and SQLite restart authority', async () => {
	const fixture = await openFrontendApplication();
	vi.stubGlobal('fetch', fixture.fetch);
	try {
		const real = await (async () => {
			const { createAccessApi } =
				await import('../../../../packages/frontend/src/features/auth/api/access-api.ts');
			const { configurationApi } =
				await import('../../../../packages/frontend/src/features/preferences/api/configuration-api.ts');
			const { ConfigurationFailure } =
				await import('../../../../packages/frontend/src/features/preferences/model/configuration-types.ts');
			const access = createAccessApi();
			await access.setup({
				username: 'admin',
				password: 'fixture-password-123',
				confirmPassword: 'fixture-password-123',
			});
			await access.login({ username: 'admin', password: 'fixture-password-123' });
			const before = await configurationApi.get();
			const after = await configurationApi.saveMonitoring(before, {
				statusIntervalSeconds: 7,
				hostIntervalSeconds: 47,
			});
			if (
				after.revision !== before.revision + 1 ||
				after.statusIntervalSeconds !== 7 ||
				after.hostIntervalSeconds !== 47 ||
				after.effectiveMonitoring.statusIntervalSeconds !== 7 ||
				after.effectiveMonitoring.hostIntervalSeconds !== 47 ||
				after.pendingRestart
			)
				throw Error('saved/effective facts diverged');
			if (
				JSON.stringify(after.network) !== JSON.stringify(before.network) ||
				JSON.stringify(after.passkeySites) !== JSON.stringify(before.passkeySites) ||
				JSON.stringify(after.captcha) !== JSON.stringify(before.captcha)
			)
				throw Error('unrelated configuration changed');
			try {
				await configurationApi.saveMonitoring(before, { statusIntervalSeconds: 9, hostIntervalSeconds: 49 });
				throw Error('stale CAS accepted');
			} catch (cause) {
				if (!(cause instanceof ConfigurationFailure) || cause.code !== 'version_conflict') throw cause;
			}
			const saved = await configurationApi.get();
			if (saved.statusIntervalSeconds !== 7 || saved.effectiveRevision !== saved.revision)
				throw Error('CAS changed saved authority');
			return [
				'real HTTP save applies monitoring without restart',
				'unrelated configuration preserved',
				'stale CAS refused and read-only authority',
			];
		})();
		assert.deepEqual(await (await fetch('/api/v1/settings')).json(), baseline);
		await fixture.restart();
		const restarted = await (async () => {
			const { configurationApi } =
				await import('../../../../packages/frontend/src/features/preferences/api/configuration-api.ts');
			const value = await configurationApi.get();
			if (
				value.pendingRestart ||
				value.revision !== value.effectiveRevision ||
				value.effectiveMonitoring.statusIntervalSeconds !== 7 ||
				value.effectiveMonitoring.hostIntervalSeconds !== 47
			)
				throw Error('restart did not install saved monitoring');
			return 'real SQLite restart installs saved monitoring';
		})();
		assert.equal(real.length, 3);
		assert.equal(restarted, 'real SQLite restart installs saved monitoring');
	} finally {
		await fixture.close();
	}
});

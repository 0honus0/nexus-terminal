import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
afterEach(() => vi.unstubAllGlobals());

test('system overview uses actual authorization, host status, empty listing and revoked cookies', async () => {
	const fixture = await openFrontendApplication();
	vi.stubGlobal('fetch', fixture.fetch);
	try {
		const { createAccessApi } = await import('../../../../packages/frontend/src/features/auth/api/access-api.ts');
		const { systemOverviewApi } =
			await import('../../../../packages/frontend/src/features/system-overview/api/system-overview-api.ts');
		const { ResourceFailure } =
			await import('../../../../packages/frontend/src/features/system-overview/model/system-overview-types.ts');
		const results = [];

		const check = (value, name) => {
			if (!value) {
				throw Error(name);
			}
			results.push(name);
		};

		try {
			await systemOverviewApi.local();
			throw Error('anonymous accepted');
		} catch (cause) {
			check(cause instanceof ResourceFailure && cause.code === 'unauthenticated', 'real local authorization');
		}
		const access = createAccessApi();
		await access.setup({
			username: 'admin',
			password: 'fixture-password-123',
			confirmPassword: 'fixture-password-123',
		});
		await access.login({ username: 'admin', password: 'fixture-password-123' });
		const sample = await systemOverviewApi.local();
		check(Number.isFinite(sample.cpuPercent) && sample.memTotal > 0, 'real host status and projection');
		check(!('uptimeSeconds' in sample), 'projection only publishes application fields');
		const listing = await fetch('/api/v1/system/ssh-resources');
		const rows = await listing.json();
		check(listing.status === 200 && Array.isArray(rows) && rows.length === 0, 'real empty SSH list');
		try {
			await systemOverviewApi.ssh({ id: 1, host: 'host', port: 22, name: null, username: 'fixture' });
			throw Error('missing connection accepted');
		} catch (cause) {
			check(cause instanceof ResourceFailure && cause.code === 'not_found', 'real missing SSH connection');
		}
		await access.logout();
		try {
			await systemOverviewApi.local();
			throw Error('revoked accepted');
		} catch (cause) {
			check(cause instanceof ResourceFailure && cause.code === 'unauthenticated', 'real revoked cookie');
		}
		assert.equal(results.length, 6);
	} finally {
		await fixture.close();
	}
});

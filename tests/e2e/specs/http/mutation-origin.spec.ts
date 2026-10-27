import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import {
	readPreferencesResponse,
	readPreferencesUpdate,
	readPresentationUpdateResponse,
} from '../../../../packages/shared/src/preferences/presentation/http-codec';

const cases = [
	{ name: 'public same-origin browser mutation succeeds', origin: 'public', site: 'same-origin', allowed: true },
	{ name: 'positive same-origin metadata without Origin succeeds', site: 'same-origin', allowed: true },
	{
		name: 'direct unconfigured backend Host is rejected',
		direct: true,
		origin: 'public',
		allowed: false,
		code: 'invalid_host',
	},
	{ name: 'mutation without Origin or Fetch Metadata is rejected', allowed: false, code: 'csrf_rejected' },
	{
		name: 'foreign Origin cannot mutate authenticated preferences',
		origin: 'https://foreign.invalid',
		allowed: false,
		code: 'csrf_rejected',
	},
	{
		name: 'opaque null Origin cannot mutate authenticated preferences',
		origin: 'null',
		allowed: false,
		code: 'csrf_rejected',
	},
	{
		name: 'Origin containing a path cannot mutate authenticated preferences',
		origin: 'path',
		allowed: false,
		code: 'csrf_rejected',
	},
	{
		name: 'cross-site Fetch Metadata overrides matching Origin',
		origin: 'public',
		site: 'cross-site',
		allowed: false,
		code: 'csrf_rejected',
	},
	{
		name: 'same-site Fetch Metadata without Origin cannot mutate preferences',
		site: 'same-site',
		allowed: false,
		code: 'csrf_rejected',
	},
];

for (const scenario of cases) {
	test(scenario.name, async ({ request }) => {
		await loginAsInitialAdmin(request);
		const before = await request.get('/api/v1/settings/preferences');
		expect(before.ok()).toBeTruthy();
		const original = readPreferencesResponse(await before.json());
		const input = readPreferencesUpdate({ expectedVersion: original.version, preferences: original.preferences });
		input.preferences.language = original.preferences.language === 'en-US' ? 'zh-CN' : 'en-US';
		const origin =
			scenario.origin === 'public'
				? E2E_URLS.frontendOrigin
				: scenario.origin === 'path'
					? E2E_URLS.frontendOrigin + '/untrusted'
					: scenario.origin;
		const response = await request.put(
			scenario.direct ? E2E_URLS.backendOrigin + '/api/v1/settings/preferences' : '/api/v1/settings/preferences',
			{
				headers: {
					...(origin ? { Origin: origin } : {}),
					...(scenario.site ? { 'Sec-Fetch-Site': scenario.site } : {}),
				},
				data: input,
			},
		);
		expect(response.status(), await response.text()).toBe(scenario.allowed ? 200 : 403);
		if (scenario.allowed) {
			const saved = readPresentationUpdateResponse(await response.json());
			expect(saved.version).toBe(original.version + 1);
			expect(saved.value.preferences.language).toBe(input.preferences.language);
		} else {
			await expect(response.json()).resolves.toEqual({ code: scenario.code });
		}
		const after = await request.get('/api/v1/settings/preferences');
		expect(after.ok()).toBeTruthy();
		const current = readPreferencesResponse(await after.json());
		expect(current.preferences.language).toBe(
			scenario.allowed ? input.preferences.language : original.preferences.language,
		);
		expect(current.version).toBe(scenario.allowed ? original.version + 1 : original.version);
	});
}

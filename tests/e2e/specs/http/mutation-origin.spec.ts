import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';

const cases = [
	{ name: 'public same-origin browser mutation succeeds', origin: 'public', site: 'same-origin', allowed: true },
	{ name: 'direct backend same-origin mutation succeeds', origin: 'direct', site: 'same-origin', allowed: true },
	{ name: 'non-browser mutation without Origin or Fetch Metadata succeeds', allowed: true },
	{ name: 'foreign Origin cannot mutate authenticated settings', origin: 'https://foreign.invalid', allowed: false },
	{ name: 'opaque null Origin cannot mutate authenticated settings', origin: 'null', allowed: false },
	{ name: 'Origin containing a path cannot mutate authenticated settings', origin: 'path', allowed: false },
	{
		name: 'cross-site Fetch Metadata overrides matching Origin',
		origin: 'public',
		site: 'cross-site',
		allowed: false,
	},
	{ name: 'same-site Fetch Metadata without Origin cannot mutate settings', site: 'same-site', allowed: false },
] as const;

for (const scenario of cases) {
	test(scenario.name, async ({ request }) => {
		await loginAsInitialAdmin(request);
		const before = await request.get('/api/v1/settings');
		expect(before.ok()).toBeTruthy();
		const original = (await before.json()) as { language: string };
		const language = original.language === 'en-US' ? 'zh-CN' : 'en-US';
		const config = scenario as { origin?: string; site?: string; allowed: boolean };
		const direct = new URL(E2E_URLS.backendOrigin);
		direct.hostname = 'localhost';
		const origin =
			config.origin === 'public'
				? E2E_URLS.frontendOrigin
				: config.origin === 'direct'
					? direct.origin
					: config.origin === 'path'
						? `${E2E_URLS.frontendOrigin}/untrusted`
						: config.origin;
		try {
			const response = await request.put(
				config.origin === 'direct' ? `${direct.origin}/api/v1/settings` : '/api/v1/settings',
				{
					headers: {
						...(origin ? { Origin: origin } : {}),
						...(config.site ? { 'Sec-Fetch-Site': config.site } : {}),
					},
					data: { language },
				},
			);
			expect(response.status(), await response.text()).toBe(config.allowed ? 200 : 403);
			if (!config.allowed) await expect(response.json()).resolves.toMatchObject({ code: 'CSRF_REJECTED' });
			const after = await request.get('/api/v1/settings');
			expect(after.ok()).toBeTruthy();
			expect((await after.json()).language).toBe(config.allowed ? language : original.language);
		} finally {
			const restored = await request.put('/api/v1/settings', { data: { language: original.language } });
			expect(restored.ok()).toBeTruthy();
		}
	});
}

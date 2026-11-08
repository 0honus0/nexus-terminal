import { expect, test } from '../../support/fixtures';

test.beforeEach(async ({ page }) => {
	await page.route('**/locale-fixture', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<html lang="en"><body></body></html>' }),
	);
	await page.goto('/locale-fixture');
});

test('Language catalogs are lazy and the last requested language wins concurrent changes', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', (request) => {
		if (/\/(?:en-US|zh-CN|ja-JP)[^/]*\.js(?:\?|$)/.test(request.url())) requests.push(request.url());
	});
	const result = await page.evaluate(async () => {
		const path = '/__e2e__/browser-locale.js';
		const client = await import(path);
		await client.setLocale('en-US');
		const before = client.getLocale();
		await Promise.all([client.setLocale('ja-JP'), client.setLocale('zh-CN')]);
		return { before, after: client.getLocale(), lang: document.documentElement.lang };
	});
	expect(result).toEqual({ before: 'en-US', after: 'zh-CN', lang: 'zh-CN' });
	expect(requests.filter((url) => url.includes('en-US'))).toHaveLength(1);
	expect(requests.filter((url) => url.includes('ja-JP'))).toHaveLength(1);
	expect(requests.filter((url) => url.includes('zh-CN'))).toHaveLength(1);
});

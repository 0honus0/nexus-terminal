import { test, expect } from '../../support/fixtures';
import { openOidcProvider } from '../../../support/protocols/oidc-provider';
import { createOidcClient } from '../../../support/http/oidc-client';
import { E2E_URLS } from '../../../support/protocols/test-environment';
const oidcHeaders = { Origin: E2E_URLS.frontendOrigin };
import { E2E_ADMIN, loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 400 },
]) {
	test(`OIDC browser login, settings and callback at ${viewport.width}x${viewport.height}`, async ({ page }) => {
		const provider = await openOidcProvider();
		try {
			await page.setViewportSize(viewport);
			const c = await createOidcClient(page.request, E2E_ADMIN, E2E_URLS.frontendOrigin).configure(
				provider.issuer,
			);
			await setUiLanguage(page.request, 'en-US');
			await createOidcClient(page.request, E2E_ADMIN, E2E_URLS.frontendOrigin).bind(provider, c.revision);
			await page.request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
			await page.goto('/login');
			const login = page.locator('.login-oidc');
			await expect(login).toContainText('Pocket ID');
			await login.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
			await login.click({ trial: true });
			await captureFunctionalScreenshot(page, `oidc-login-${viewport.width}x${viewport.height}.png`);
			await login.click();
			await expect(page).toHaveURL(/\/$/u);
			expect(await page.evaluate(() => location.search)).toBe('');
			expect((await page.request.get('/api/v1/auth/status')).status()).toBe(200);
			// Re-login with password, so unlink does not intentionally revoke the current UI session.
			await page.request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
			await page.request.post('/api/v1/auth/login', {
				headers: oidcHeaders,
				data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
			});
			await page.goto('/settings?tab=security');
			await expect(page.locator('#oidc-callback')).toHaveValue(c.callbackUrl);
			await expect(page.locator('#oidc-secret')).toHaveValue('');
			await page.locator('#oidc-password').fill(E2E_ADMIN.password);
			await page.getByRole('button', { name: 'Unlink account', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Link account', exact: true })).toBeVisible();
			await page.locator('#oidc-password').fill(E2E_ADMIN.password);
			await page.getByRole('button', { name: 'Link account', exact: true }).click();
			await expect(page).toHaveURL(/\/settings\?tab=security$/u);
			await expect(page.getByRole('button', { name: 'Unlink account', exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			await page.locator('#oidc-settings-form').scrollIntoViewIfNeeded();
			await captureFunctionalScreenshot(page, `oidc-settings-${viewport.width}x${viewport.height}.png`);
		} finally {
			await provider.close();
		}
	});
}

test('OIDC configuration saves through the UI and disabling signs out the current OIDC session', async ({ page }) => {
	const provider = await openOidcProvider();
	try {
		await loginAsInitialAdmin(page.request);
		await setUiLanguage(page.request, 'en-US');
		await page.goto('/settings?tab=security');
		await page.locator('#oidc-issuer').fill(provider.issuer);
		await page.locator('#oidc-client').fill('nexus-client');
		await page.locator('#oidc-secret').fill('oidc-test-secret');
		await page.locator('#oidc-password').fill(E2E_ADMIN.password);
		await page.getByLabel('Show on the login page', { exact: true }).check();
		await page.locator('button[form="oidc-settings-form"]').click();
		await expect(page.locator('#oidc-secret')).toHaveValue('');
		await page.locator('#oidc-password').fill(E2E_ADMIN.password);
		await page.getByRole('button', { name: 'Link account', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Unlink account', exact: true })).toBeVisible();
		await page.request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
		await page.goto('/login');
		await page.locator('.login-oidc').click();
		await expect(page).toHaveURL(/\/$/u);
		await page.goto('/settings?tab=security');
		await page.getByLabel('Show on the login page', { exact: true }).uncheck();
		await page.locator('#oidc-password').fill(E2E_ADMIN.password);
		await page.locator('button[form="oidc-settings-form"]').click();
		await expect(page).toHaveURL(/\/login$/u);
		await expect(page.locator('.login-oidc')).toHaveCount(0);
		expect((await page.request.get('/api/v1/auth/status')).status()).toBe(401);
	} finally {
		await provider.close();
	}
});

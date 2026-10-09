import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';

const HCAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
const RECAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000002';

async function resetCaptcha(request: import('@playwright/test').APIRequestContext): Promise<void> {
	const response = await request.put('/api/v1/settings/captcha', {
		data: {
			enabled: false,
			provider: 'none',
			hcaptchaSiteKey: '',
			hcaptchaSecretKey: '',
			recaptchaSiteKey: '',
			recaptchaSecretKey: '',
		},
	});
	expect(response.ok()).toBeTruthy();
}

test('CAPTCHA settings UI enables a provider, persists public configuration, and disables it again', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await resetCaptcha(context.request);
	const language = await context.request.put('/api/v1/settings', {
		data: { language: 'en-US', timezone: 'UTC' },
	});
	expect(language.ok()).toBeTruthy();

	try {
		await page.goto('/settings');
		const captchaLoadPromise = page.waitForResponse(
			(response) => response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'GET',
		);
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		expect((await captchaLoadPromise).ok()).toBeTruthy();
		const captcha = page.getByRole('heading', { name: 'CAPTCHA Settings', exact: true }).locator('..');
		await expect(captcha).toBeVisible();
		await expect(captcha.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
		await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toBeVisible();
		await captureFunctionalScreenshot(page, 'security-settings.png', { viewport: { width: 1440, height: 900 } });

		await step('enable hCaptcha and save provider keys through the UI', async () => {
			await captcha.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' }).check();
			await selectUiOption(captcha.locator('#captchaProvider'), 'hcaptcha');
			await captcha.locator('#hcaptchaSiteKey').fill(HCAPTCHA_SITE_KEY);
			await captcha.locator('#hcaptchaSecretKey').fill('e2e-hcaptcha-secret');
			const savePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'PUT',
			);
			await captcha.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await savePromise).ok()).toBeTruthy();

			const publicConfig = await context.request.get('/api/v1/settings/captcha');
			expect(publicConfig.ok()).toBeTruthy();
			await expect(publicConfig.json()).resolves.toEqual({
				enabled: true,
				provider: 'hcaptcha',
				hcaptchaSiteKey: HCAPTCHA_SITE_KEY,
				recaptchaSiteKey: '',
			});
			await expect(publicConfig.json()).resolves.not.toHaveProperty('hcaptchaSecretKey');
		});

		await step('reload keeps the saved provider visible without exposing the secret', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			const reloaded = captcha;
			await expect(reloaded.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' })).toBeChecked();
			await expectUiSelectValue(reloaded.locator('#captchaProvider'), 'hcaptcha');
			await expect(reloaded.locator('#hcaptchaSiteKey')).toHaveValue(HCAPTCHA_SITE_KEY);
			await expect(reloaded.locator('#hcaptchaSecretKey')).toHaveAttribute('type', 'password');
			await expect(reloaded.locator('#hcaptchaSecretKey')).toHaveValue('');
		});

		await step('switch to reCAPTCHA and persist its public configuration through the UI', async () => {
			const reloaded = captcha;
			await selectUiOption(reloaded.locator('#captchaProvider'), 'recaptcha');
			await reloaded.locator('#recaptchaSiteKey').fill(RECAPTCHA_SITE_KEY);
			await reloaded.locator('#recaptchaSecretKey').fill('e2e-recaptcha-secret');
			const savePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'PUT',
			);
			await reloaded.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await savePromise).ok()).toBeTruthy();
			await expect(reloaded.locator('#recaptchaSecretKey')).toHaveValue('');

			const publicConfig = await context.request.get('/api/v1/settings/captcha');
			expect(publicConfig.ok()).toBeTruthy();
			await expect(publicConfig.json()).resolves.toEqual({
				enabled: true,
				provider: 'recaptcha',
				hcaptchaSiteKey: HCAPTCHA_SITE_KEY,
				recaptchaSiteKey: RECAPTCHA_SITE_KEY,
			});
			await expect(publicConfig.json()).resolves.not.toHaveProperty('recaptchaSecretKey');
		});

		await step('reload keeps reCAPTCHA public configuration without exposing its secret', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			const reloaded = captcha;
			await expect(reloaded.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' })).toBeChecked();
			await expectUiSelectValue(reloaded.locator('#captchaProvider'), 'recaptcha');
			await expect(reloaded.locator('#recaptchaSiteKey')).toHaveValue(RECAPTCHA_SITE_KEY);
			await expect(reloaded.locator('#recaptchaSecretKey')).toHaveAttribute('type', 'password');
			await expect(reloaded.locator('#recaptchaSecretKey')).toHaveValue('');
		});

		await step('disable CAPTCHA through the UI and persist the safe default', async () => {
			const reloaded = captcha;
			await reloaded.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' }).uncheck();
			await expectUiSelectValue(reloaded.locator('#captchaProvider'), 'none');
			const savePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/settings/captcha') && response.request().method() === 'PUT',
			);
			await reloaded.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await savePromise).ok()).toBeTruthy();
			const publicConfig = await context.request.get('/api/v1/settings/captcha');
			await expect(publicConfig.json()).resolves.toMatchObject({ enabled: false, provider: 'none' });
		});
	} finally {
		await resetCaptcha(context.request);
	}
});

import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';
import { getTestSettings, updateTestCaptcha } from '../../support/settings';
import { readAccessCaptchaConfig } from '../../../../packages/shared/src/access/http';

const HCAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
const RECAPTCHA_SITE_KEY = '10000000-ffff-ffff-ffff-000000000002';

test('CAPTCHA UI saves provider configuration and explicit secrets without activating it before restart', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await updateTestCaptcha(context.request, {
		enabled: false,
		provider: 'none',
		siteKey: '',
		expectedHostname: null,
		secret: { action: 'clear' },
	});
	const publicBefore = await context.request.get('/api/v1/auth/captcha/config');
	expect(publicBefore.ok()).toBe(true);
	const effective = readAccessCaptchaConfig(await publicBefore.json());
	const baseline = await getTestSettings(context.request);
	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		const captcha = page
			.getByRole('heading', { name: 'CAPTCHA Settings', exact: true })
			.locator('xpath=ancestor::section[1]');
		await expect(captcha).toBeVisible();
		await expect(captcha.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		await expect(page.getByRole('heading', { name: 'Change Password', exact: true })).toBeVisible();
		await captureFunctionalScreenshot(page, 'security-settings.png', { viewport: { width: 1440, height: 900 } });

		async function saveCaptcha(): Promise<void> {
			const current = await getTestSettings(context.request);
			const response = page.waitForResponse(
				(value) => value.url().endsWith('/api/v1/settings/captcha') && value.request().method() === 'PUT',
			);
			await captcha.getByRole('button', { name: 'Save', exact: true }).click();
			const result = await response;
			expect(result.ok()).toBe(true);
			// GET /settings/captcha is the *public effective* CAPTCHA config,
			// not the versioned write receipt. Read the authenticated installation
			// settings to verify persistence after navigation retires the PUT body.
			const saved = await getTestSettings(context.request);
			expect(saved.version).toBe(current.version + 1);
			expect(saved.effectiveVersion).toBe(baseline.effectiveVersion);
			expect(saved.requiresRestart).toBe(true);
			await expect(captcha.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
			const config = await context.request.get('/api/v1/auth/captcha/config');
			expect(config.ok()).toBe(true);
			expect(readAccessCaptchaConfig(await config.json())).toEqual(effective);
		}

		await step('enable hCaptcha through explicit secret replacement', async () => {
			await captcha.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' }).check();
			await selectUiOption(captcha.locator('#captcha-provider'), 'hcaptcha');
			await captcha.locator('#captcha-site').fill(HCAPTCHA_SITE_KEY);
			await captcha.locator('#captcha-hostname').fill('localhost');
			await selectUiOption(captcha.locator('#captcha-secret-action'), 'replace');
			await expect(captcha.locator('#captcha-secret')).toHaveAttribute('type', 'password');
			await captcha.locator('#captcha-secret').fill('e2e-hcaptcha-secret');
			await saveCaptcha();
			expect((await getTestSettings(context.request)).captcha).toEqual({
				enabled: true,
				provider: 'hcaptcha',
				siteKey: HCAPTCHA_SITE_KEY,
				expectedHostname: 'localhost',
				hasSecret: true,
			});
			await expect(captcha.locator('#captcha-secret')).toHaveCount(0);
		});
		await step('reload retains public fields and never exposes the saved secret', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			await expect(captcha.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' })).toBeChecked();
			await expectUiSelectValue(captcha.locator('#captcha-provider'), 'hcaptcha');
			await expect(captcha.locator('#captcha-site')).toHaveValue(HCAPTCHA_SITE_KEY);
			await expectUiSelectValue(captcha.locator('#captcha-secret-action'), 'keep');
			await expect(captcha.locator('#captcha-secret')).toHaveCount(0);
		});
		await step('replace provider credentials and persist reCAPTCHA without exposing them', async () => {
			await selectUiOption(captcha.locator('#captcha-provider'), 'recaptcha');
			await captcha.locator('#captcha-site').fill(RECAPTCHA_SITE_KEY);
			await selectUiOption(captcha.locator('#captcha-secret-action'), 'replace');
			await captcha.locator('#captcha-secret').fill('e2e-recaptcha-secret');
			await saveCaptcha();
			const saved = await getTestSettings(context.request);
			expect(saved.captcha).toEqual({
				enabled: true,
				provider: 'recaptcha',
				siteKey: RECAPTCHA_SITE_KEY,
				expectedHostname: 'localhost',
				hasSecret: true,
			});
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			await expectUiSelectValue(captcha.locator('#captcha-provider'), 'recaptcha');
			await expect(captcha.locator('#captcha-site')).toHaveValue(RECAPTCHA_SITE_KEY);
			await expect(captcha.locator('#captcha-secret')).toHaveCount(0);
		});
		await step('disable CAPTCHA and explicitly clear the stored secret', async () => {
			await captcha.locator('#captcha-site').fill('');
			await captcha.locator('#captcha-hostname').fill('');
			await selectUiOption(captcha.locator('#captcha-secret-action'), 'clear');
			await captcha.getByRole('checkbox', { name: 'Enable CAPTCHA on Login Page' }).uncheck();
			await selectUiOption(captcha.locator('#captcha-provider'), 'none');
			await saveCaptcha();
			expect((await getTestSettings(context.request)).captcha).toEqual({
				enabled: false,
				provider: 'none',
				siteKey: '',
				expectedHostname: null,
				hasSecret: false,
			});
		});
	} finally {
		await updateTestCaptcha(context.request, {
			enabled: false,
			provider: 'none',
			siteKey: '',
			expectedHostname: null,
			secret: { action: 'clear' },
		});
	}
});

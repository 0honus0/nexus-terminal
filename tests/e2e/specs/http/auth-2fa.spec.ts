import { writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

import { E2E_URLS } from '../../support/test-env';
import { readAccessTotpSetup } from '../../../../packages/shared/src/access/factors/http-codec';
import { readAccessCaptchaConfig, readAccessHttpError } from '../../../../packages/shared/src/access/http';

const headers = { Origin: E2E_URLS.frontendOrigin };

async function submitTwoFactorChallenge(
	page: Page,
	submit: () => Promise<void>,
): Promise<{ status: number; code: string }> {
	const url = '**/api/v1/auth/login/2fa';
	let code: string | null = null;
	await page.route(url, async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		// Capture the original 401 before navigation retires its CDP body.
		// Never replay this credential/challenge mutation just to inspect it.
		const upstream = await route.fetch();
		code = readAccessHttpError(await upstream.json()).code;
		await route.fulfill({ response: upstream });
	});
	try {
		const responsePromise = page.waitForResponse(
			(response) => response.url().endsWith('/api/v1/auth/login/2fa') && response.request().method() === 'POST',
		);
		await submit();
		const response = await responsePromise;
		expect(code, 'Captured exact 2FA error response before navigation').not.toBeNull();
		return { status: response.status(), code: code! };
	} finally {
		await page.unroute(url);
	}
}

function totpCode(secret: string, now = Date.now()): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid fixture TOTP secret');
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const bytes: number[] = [];
	for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
	const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
	return String((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function invalidTotpCode(secret: string): string {
	const now = Date.now();
	// Exclude adjacent windows too, so a clock boundary cannot make the negative case valid.
	const accepted = new Set([-2, -1, 0, 1, 2].map((offset) => totpCode(secret, now + offset * 30_000)));
	for (let candidate = 0; candidate < 1_000_000; candidate++) {
		const token = String(candidate).padStart(6, '0');
		if (!accepted.has(token)) return token;
	}
	throw new Error('Unable to choose an invalid TOTP fixture');
}

type LoginViewport = {
	name: 'desktop' | 'narrow';
	width: number;
	height: number;
};

type LoginEvidenceStage = 'challenge' | 'invalid-token' | 'expired-recovery';

const LOGIN_VIEWPORTS: LoginViewport[] = [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'narrow', width: 375, height: 812 },
];

async function prepareTwoFactorLogin(context: BrowserContext): Promise<string> {
	const request = context.request;
	await loginAsInitialAdmin(request);

	await setUiLanguage(request);

	const setup = await request.post('/api/v1/auth/2fa/setup', { headers });
	expect(setup.ok()).toBeTruthy();
	const setupBody = readAccessTotpSetup(await setup.json());
	expect(setupBody.secret).toBeTruthy();
	expect(setupBody.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

	const token = totpCode(setupBody.secret);
	const verify = await request.post('/api/v1/auth/2fa/verify', { headers, data: { token } });
	expect(verify.ok()).toBeTruthy();

	const logout = await request.post('/api/v1/auth/logout', { headers });
	expect(logout.ok()).toBeTruthy();
	return setupBody.secret;
}

async function recordLoginEvidence(
	page: Page,
	testInfo: TestInfo,
	viewport: LoginViewport,
	stage: LoginEvidenceStage,
): Promise<void> {
	const pageMetrics = await page.evaluate(() => {
		const readElement = (selector: string) => {
			const element = document.querySelector<HTMLElement>(selector);
			const input = element instanceof HTMLInputElement ? element : null;
			const box = element?.getBoundingClientRect();
			const style = element ? getComputedStyle(element) : null;
			const visible = Boolean(
				element &&
				box &&
				box.width > 0 &&
				box.height > 0 &&
				style?.display !== 'none' &&
				style?.visibility !== 'hidden',
			);
			return {
				selector,
				exists: Boolean(element),
				visible,
				value: input?.type === 'password' ? null : (input?.value ?? null),
				valueLength: input?.value.length ?? null,
				checked: input?.checked ?? null,
				disabled: input?.disabled ?? null,
				editable: input ? !input.disabled && !input.readOnly : null,
				text: element?.textContent?.trim() ?? '',
				bbox: box
					? {
							x: box.x,
							y: box.y,
							width: box.width,
							height: box.height,
							right: box.right,
							bottom: box.bottom,
						}
					: null,
			};
		};

		const documentElement = document.documentElement;
		const body = document.body;
		return {
			url: window.location.href,
			viewport: {
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				clientWidth: documentElement.clientWidth,
				clientHeight: documentElement.clientHeight,
				devicePixelRatio: window.devicePixelRatio,
			},
			scroll: {
				window: { x: window.scrollX, y: window.scrollY },
				document: {
					clientWidth: documentElement.clientWidth,
					clientHeight: documentElement.clientHeight,
					scrollWidth: documentElement.scrollWidth,
					scrollHeight: documentElement.scrollHeight,
				},
				body: {
					clientWidth: body.clientWidth,
					clientHeight: body.clientHeight,
					scrollWidth: body.scrollWidth,
					scrollHeight: body.scrollHeight,
				},
			},
			elements: {
				username: readElement('#username'),
				password: readElement('#password'),
				rememberMe: readElement('#rememberMe'),
				twoFactorToken: readElement('#twoFactorToken'),
				alert: readElement('[role="alert"]'),
				submit: readElement('form button[type="submit"]'),
			},
		};
	});

	const metrics = {
		case: 'M01.02-login-2fa',
		stage,
		expectedViewport: { width: viewport.width, height: viewport.height },
		...pageMetrics,
	};
	expect(metrics.viewport.innerWidth).toBe(viewport.width);
	expect(metrics.viewport.innerHeight).toBe(viewport.height);
	expect(metrics.scroll.document.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
	expect(metrics.scroll.body.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);

	const metricsPath = testInfo.outputPath(`m01-02-login-2fa-${viewport.name}-${stage}.metrics.json`);
	await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
	await testInfo.attach(`M01.02 ${viewport.name} ${stage} metrics`, {
		path: metricsPath,
		contentType: 'application/json',
	});
	console.log(JSON.stringify(metrics));

	if (viewport.name === 'desktop' && stage === 'challenge') {
		await captureFunctionalScreenshot(page, 'auth-2fa-desktop-challenge.png');
		return;
	}
	if (viewport.name === 'desktop' && stage === 'invalid-token') {
		await captureFunctionalScreenshot(page, 'auth-2fa-desktop-invalid-token.png');
		return;
	}
	if (viewport.name === 'desktop' && stage === 'expired-recovery') {
		await captureFunctionalScreenshot(page, 'auth-2fa-desktop-expired-recovery.png');
		return;
	}
	if (viewport.name === 'narrow' && stage === 'challenge') {
		await captureFunctionalScreenshot(page, 'auth-2fa-narrow-challenge.png');
		return;
	}
	if (viewport.name === 'narrow' && stage === 'invalid-token') {
		await captureFunctionalScreenshot(page, 'auth-2fa-narrow-invalid-token.png');
		return;
	}
	await captureFunctionalScreenshot(page, 'auth-2fa-narrow-expired-recovery.png');
}

test('2FA can be enabled, required at login, verified, and disabled', async ({ request }) => {
	await loginAsInitialAdmin(request);

	let secret = '';
	await step('start and activate TOTP 2FA', async () => {
		const setup = await request.post('/api/v1/auth/2fa/setup', { headers });
		expect(setup.ok()).toBeTruthy();
		const setupBody = readAccessTotpSetup(await setup.json());
		secret = setupBody.secret;
		expect(secret).toBeTruthy();
		expect(setupBody.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

		const token = totpCode(secret);
		const verify = await request.post('/api/v1/auth/2fa/verify', { headers, data: { token } });
		expect(verify.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({
			isAuthenticated: true,
			user: { username: E2E_ADMIN.username, twoFactorEnabled: true },
		});
	});

	await step('password login is blocked behind the second factor', async () => {
		expect((await request.post('/api/v1/auth/logout', { headers })).ok()).toBeTruthy();
		const login = await request.post('/api/v1/auth/login', {
			headers,
			data: {
				username: E2E_ADMIN.username,
				password: E2E_ADMIN.password,
				rememberMe: false,
			},
		});
		expect(login.ok()).toBeTruthy();
		await expect(login.json()).resolves.toMatchObject({ requiresTwoFactor: true });

		const incompleteStatus = await request.get('/api/v1/auth/status');
		expect(incompleteStatus.status()).toBe(401);
	});

	await step('a real current TOTP completes login', async () => {
		const invalid = await request.post('/api/v1/auth/login/2fa', {
			headers,
			data: { token: invalidTotpCode(secret) },
		});
		expect(invalid.status()).toBe(401);

		const token = totpCode(secret);
		const verify = await request.post('/api/v1/auth/login/2fa', { headers, data: { token } });
		expect(verify.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
	});

	await step('2FA can be disabled only with the current password', async () => {
		const wrongPassword = await request.delete('/api/v1/auth/2fa', {
			headers,
			data: { password: 'not-the-password' },
		});
		expect(wrongPassword.status()).toBe(401);

		const disable = await request.delete('/api/v1/auth/2fa', { headers, data: { password: E2E_ADMIN.password } });
		expect(disable.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({
			user: { username: E2E_ADMIN.username, twoFactorEnabled: false },
		});
	});
});

test('2FA settings UI completes setup, reports errors, reloads, and disables the real server state', async ({
	page,
	context,
}) => {
	const request = context.request;
	await loginAsInitialAdmin(request);
	await setUiLanguage(request);

	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		const panel = page
			.getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true })
			.locator('..');
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('Two-factor authentication is currently disabled.');

		await step('start and activate TOTP through the Security UI', async () => {
			const setupPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/auth/2fa/setup') && response.request().method() === 'POST',
			);
			await panel.getByRole('button', { name: 'Enable Two-Factor Authentication', exact: true }).click();
			const setupResponse = await setupPromise;
			expect(setupResponse.ok()).toBeTruthy();
			// Read the on-screen secret and QR code: CDP may lose the response body
			// during navigation, while the rendered TOTP setup is the UI contract.
			const secret = (await panel.locator('code').innerText()).trim();
			expect(secret).toMatch(/^[A-Z2-7]{32}$/);
			await expect(panel.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
			const token = totpCode(secret);
			await panel.locator('#verificationCode').fill(token);
			const verifyPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/auth/2fa/verify') && response.request().method() === 'POST',
			);
			await panel.getByRole('button', { name: 'Verify & Activate', exact: true }).click();
			expect((await verifyPromise).ok()).toBeTruthy();
			await expect(panel).toContainText('Two-factor authentication is enabled.');
			await expect(panel).toContainText('Two-factor authentication activated successfully!');
		});

		await step('reload preserves enabled 2FA state and rejects a wrong disable password', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			const reloadedPanel = page
				.getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true })
				.locator('..');
			await expect(reloadedPanel).toContainText('Two-factor authentication is enabled.');
			await reloadedPanel.locator('#disablePassword').fill('not-the-password');
			const wrongPasswordPromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/auth/2fa') && response.request().method() === 'DELETE',
			);
			await reloadedPanel.getByRole('button', { name: 'Disable Two-Factor Authentication', exact: true }).click();
			expect((await wrongPasswordPromise).status()).toBe(401);
			await expect(reloadedPanel).toContainText('The username, password or verification code is incorrect.');
		});

		await step('disable 2FA through the Security UI and verify the real server state', async () => {
			const reloadedPanel = page
				.getByRole('heading', { name: 'Two-Factor Authentication (TOTP)', exact: true })
				.locator('..');
			await reloadedPanel.locator('#disablePassword').fill(E2E_ADMIN.password);
			const disablePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/auth/2fa') && response.request().method() === 'DELETE',
			);
			await reloadedPanel.getByRole('button', { name: 'Disable Two-Factor Authentication', exact: true }).click();
			expect((await disablePromise).ok()).toBeTruthy();
			await expect(reloadedPanel).toContainText('Two-factor authentication disabled successfully.');
			await expect
				.poll(
					async () =>
						(await request.get('/api/v1/auth/status').then((response) => response.json())).user
							.twoFactorEnabled,
				)
				.toBe(false);
		});
	} finally {
		const status = await request.get('/api/v1/auth/status');
		if (status.ok() && (await status.json()).user?.twoFactorEnabled) {
			await request.delete('/api/v1/auth/2fa', { headers, data: { password: E2E_ADMIN.password } });
		}
	}
});

test('Login 2FA challenge supports invalid-token retry and expired-session recovery [M01.02]', async ({
	page,
	context,
}, testInfo) => {
	const secret = await prepareTwoFactorLogin(context);
	const flow: Array<Record<string, unknown>> = [];

	try {
		for (const [index, viewport] of LOGIN_VIEWPORTS.entries()) {
			if (index > 0) {
				const logout = await context.request.post('/api/v1/auth/logout', { headers });
				expect(logout.ok()).toBeTruthy();
			}

			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			const captchaConfigPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/auth/captcha/config') && response.request().method() === 'GET',
			);
			const [, captchaConfigResponse] = await Promise.all([page.goto('/login'), captchaConfigPromise]);
			expect(captchaConfigResponse.ok()).toBeTruthy();
			const captchaConfig = await context.request.get('/api/v1/auth/captcha/config');
			expect(captchaConfig.ok()).toBeTruthy();
			expect(readAccessCaptchaConfig(await captchaConfig.json())).toMatchObject({
				enabled: false,
				provider: 'none',
			});
			await expect(page).toHaveURL(/\/login$/);
			await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();

			const username = page.locator('#username');
			const password = page.locator('#password');
			const rememberMe = page.locator('#rememberMe');
			const twoFactorToken = page.locator('#twoFactorToken');
			const submit = page.locator('form button[type="submit"]');
			const alert = page.getByRole('alert');

			let firstFactorStatus = 0;
			let invalidTokenStatus = 0;
			let expiredRecoveryStatus = 0;
			let secondFactorStatus = 0;
			let invalidTokenMessage = '';
			let expiredRecoveryMessage = '';

			await step(`${viewport.name}: enter credentials through the Login form`, async () => {
				await expect(username).toBeVisible();
				await expect(password).toBeVisible();
				await expect(rememberMe).toBeVisible();
				await expect(rememberMe).not.toBeChecked();
				await expect(submit).toBeEnabled();
				await username.fill(E2E_ADMIN.username);
				await password.fill(E2E_ADMIN.password);

				const responsePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
				);
				await submit.click();
				const response = await responsePromise;
				firstFactorStatus = response.status();
				expect(firstFactorStatus).toBe(200);
				// Successful first factor transitions the actual form into its TOTP
				// challenge. Page navigation may retire the CDP response body.
				await expect(twoFactorToken).toBeVisible();
			});

			await expect(page).toHaveURL(/\/login$/);
			await expect(twoFactorToken).toBeVisible();
			await expect(twoFactorToken).toBeEditable();
			await expect(twoFactorToken).toHaveValue('');
			await expect(submit).toHaveText('Verify');
			await expect(username).toHaveCount(0);
			await expect(password).toHaveCount(0);
			await expect(rememberMe).toHaveCount(0);
			await recordLoginEvidence(page, testInfo, viewport, 'challenge');

			await step(`${viewport.name}: reject an invalid code without leaving the challenge`, async () => {
				const invalidToken = invalidTotpCode(secret);
				await twoFactorToken.fill(invalidToken);
				const response = await submitTwoFactorChallenge(page, () => submit.click());
				invalidTokenStatus = response.status;
				expect(response.code).toBe('invalid_credentials');
				invalidTokenMessage = 'The username, password or verification code is incorrect.';
				expect(invalidTokenStatus).toBe(401);
				expect(invalidTokenMessage).toBeTruthy();
				await expect(alert).toBeVisible();
				await expect(alert).toContainText(invalidTokenMessage);
				await expect(twoFactorToken).toBeVisible();
				await expect(twoFactorToken).toHaveValue(invalidToken);
				await expect(username).toHaveCount(0);
				await expect(password).toHaveCount(0);
				await expect(submit).toHaveText('Verify');
			});
			await recordLoginEvidence(page, testInfo, viewport, 'invalid-token');

			await step(`${viewport.name}: recover when the pending challenge session is invalidated`, async () => {
				const logout = await context.request.post('/api/v1/auth/logout', { headers });
				expect(logout.ok()).toBeTruthy();

				await twoFactorToken.fill('000000');
				const response = await submitTwoFactorChallenge(page, () => submit.click());
				expiredRecoveryStatus = response.status;
				expect(response.code).toBe('unauthenticated');
				expiredRecoveryMessage = 'The login challenge expired. Sign in again.';
				expect(expiredRecoveryStatus).toBe(401);
				expect(expiredRecoveryMessage).toBeTruthy();
				await expect(alert).toBeVisible();
				await expect(alert).toContainText(expiredRecoveryMessage);
				await expect(username).toBeVisible();
				await expect(password).toBeVisible();
				await expect(rememberMe).toBeVisible();
				await expect(rememberMe).not.toBeChecked();
				await expect(twoFactorToken).toHaveCount(0);
				await expect(submit).toHaveText('Login');
			});
			await recordLoginEvidence(page, testInfo, viewport, 'expired-recovery');

			await step(`${viewport.name}: start a fresh challenge with a cleared token field`, async () => {
				await username.fill(E2E_ADMIN.username);
				await password.fill(E2E_ADMIN.password);
				const responsePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
				);
				await submit.click();
				const response = await responsePromise;
				expect(response.status()).toBe(200);
				// A fresh TOTP challenge, not the response body's CDP lifetime,
				// is the UI contract after first-factor acceptance.
				await expect(twoFactorToken).toBeVisible();
				await expect(twoFactorToken).toHaveValue('');
			});

			await step(`${viewport.name}: verify the current TOTP and reach the Dashboard`, async () => {
				const token = totpCode(secret);
				await twoFactorToken.fill(token);
				const responsePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith('/api/v1/auth/login/2fa') && response.request().method() === 'POST',
				);
				await submit.click();
				const response = await responsePromise;
				secondFactorStatus = response.status();
				expect(secondFactorStatus).toBe(200);
				await expect(page).toHaveURL(/\/$/);
				const status = await context.request.get('/api/v1/auth/status');
				expect(status.ok()).toBeTruthy();
				await expect(status.json()).resolves.toMatchObject({
					isAuthenticated: true,
					user: { username: E2E_ADMIN.username, twoFactorEnabled: true },
				});
			});

			flow.push({
				viewport,
				responses: {
					firstFactor: firstFactorStatus,
					invalidToken: invalidTokenStatus,
					expiredRecovery: expiredRecoveryStatus,
					secondFactor: secondFactorStatus,
				},
				messages: { invalidToken: invalidTokenMessage, expiredRecovery: expiredRecoveryMessage },
				finalUrl: page.url(),
			});
		}

		const flowPath = testInfo.outputPath('m01-02-login-2fa-flow.json');
		await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
		await testInfo.attach('M01.02 Login 2FA flow results', {
			path: flowPath,
			contentType: 'application/json',
		});
		console.log(JSON.stringify({ case: 'M01.02-login-2fa', flow }));
	} finally {
		const status = await context.request.get('/api/v1/auth/status');
		if (status.ok()) {
			const body = (await status.json()) as { user?: { twoFactorEnabled?: boolean } };
			if (body.user?.twoFactorEnabled) {
				await context.request.delete('/api/v1/auth/2fa', { headers, data: { password: E2E_ADMIN.password } });
			}
		}
		await context.request.post('/api/v1/auth/logout', { headers });
	}
});

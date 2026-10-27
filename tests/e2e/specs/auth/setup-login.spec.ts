import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, setUiLanguage } from '../../support/auth';
import { readPreferencesResponse } from '../../../../packages/shared/src/preferences/presentation/http-codec';

type LoginTransitionSample = {
	pathname: string;
	header: boolean;
	login: boolean;
};

test.describe('initial setup', () => {
	test.use({ e2eDatabaseMode: 'empty' });
	for (const { browserLocale, storedLocale, expectedLocale } of [
		{ browserLocale: 'zh-CN', storedLocale: null, expectedLocale: 'zh-CN' },
		{ browserLocale: 'en-US', storedLocale: 'ja-JP', expectedLocale: 'ja-JP' },
	]) {
		test.describe(`initial language ${expectedLocale}`, () => {
			test.use({ locale: browserLocale });
			test('uses the setup locale before authentication and persisted preferences after login and reload', async ({
				page,
				context,
			}) => {
				test.setTimeout(60_000);
				if (storedLocale) {
					await page.addInitScript((language) => localStorage.setItem('user-locale', language), storedLocale);
				}
				await page.goto('/');
				await expect(page).toHaveURL(/\/setup$/);
				if (expectedLocale === 'zh-CN') {
					await expect(
						page.getByRole('heading', { name: '初始设置', exact: true }).filter({ visible: true }),
					).toBeVisible();
				}
				await page.locator('#username').fill(E2E_ADMIN.username);
				await page.locator('#password').fill(E2E_ADMIN.password);
				await page.locator('#confirmPassword').fill(E2E_ADMIN.password);
				await page.locator('form button[type="submit"]').click();
				await expect(page).toHaveURL(/\/login$/);
				await page.locator('#username').fill(E2E_ADMIN.username);
				await page.locator('#password').fill(E2E_ADMIN.password);
				const settingsLoaded = page.waitForResponse(
					(response) =>
						response.url().endsWith('/api/v1/settings/preferences') &&
						response.request().method() === 'GET',
				);
				await page.locator('form button[type="submit"]').click();
				expect((await settingsLoaded).ok()).toBeTruthy();
				await expect(page).toHaveURL(/\/$/);
				await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
				const settings = await context.request.get('/api/v1/settings/preferences');
				expect(settings.ok()).toBeTruthy();
				const initialPreferences = readPreferencesResponse(await settings.json());
				expect(initialPreferences.version).toBe(0);
				expect(initialPreferences.preferences.language).toBe('en-US');
				await setUiLanguage(context.request, expectedLocale);
				const reloadedSettings = page.waitForResponse(
					(response) =>
						response.url().endsWith('/api/v1/settings/preferences') &&
						response.request().method() === 'GET',
				);
				await page.reload();
				expect((await reloadedSettings).ok()).toBeTruthy();
				await expect(page.locator('html')).toHaveAttribute('lang', expectedLocale);
			});
		});
	}

	test('creates the initial administrator and redirects to login', async ({ page, request }) => {
		const initialSetupState = await request.get('/api/v1/auth/needs-setup');
		expect(initialSetupState.ok()).toBeTruthy();
		await expect(initialSetupState.json()).resolves.toEqual({ needsSetup: true });

		await page.goto('/');
		await expect(page).toHaveURL(/\/setup$/);

		await page.locator('#username').fill(E2E_ADMIN.username);
		await page.locator('#password').fill(E2E_ADMIN.password);
		await page.locator('#confirmPassword').fill(E2E_ADMIN.password);

		const setupResponsePromise = page.waitForResponse(
			(response) => response.url().endsWith('/api/v1/auth/setup') && response.request().method() === 'POST',
		);
		await page.locator('form button[type="submit"]').click();

		const setupResponse = await setupResponsePromise;
		expect(setupResponse.status()).toBe(201);
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('banner')).toHaveCount(0);

		const setupStateAfterRegistration = await request.get('/api/v1/auth/needs-setup');
		expect(setupStateAfterRegistration.ok()).toBeTruthy();
		await expect(setupStateAfterRegistration.json()).resolves.toEqual({ needsSetup: false });
	});
	test('mobile setup retries in place and remains reachable at 320/375 viewports', async ({
		page,
		request,
	}, testInfo) => {
		const collectMetrics = async (label: string) => {
			const metrics = await page.evaluate(() => {
				const rect = (selector: string) => {
					const element = document.querySelector<HTMLElement>(selector);
					if (!element) return null;
					const box = element.getBoundingClientRect();
					return {
						x: box.x,
						y: box.y,
						width: box.width,
						height: box.height,
						right: box.right,
						bottom: box.bottom,
					};
				};

				return {
					viewport: { width: window.innerWidth, height: window.innerHeight },
					page: {
						clientWidth: document.documentElement.clientWidth,
						scrollWidth: document.documentElement.scrollWidth,
						clientHeight: document.documentElement.clientHeight,
						scrollHeight: document.documentElement.scrollHeight,
						scrollY: window.scrollY,
					},
					elements: {
						form: rect('form'),
						username: rect('#username'),
						password: rect('#password'),
						confirmPassword: rect('#confirmPassword'),
						alert: rect('[role="alert"]'),
						submit: rect('form button[type="submit"]'),
					},
				};
			});
			expect(metrics.page.scrollWidth).toBeLessThanOrEqual(metrics.page.clientWidth);
			for (const [name, element] of Object.entries(metrics.elements)) {
				if (name === 'alert' && !element) continue;
				expect(element, `${label}:${name} should be present`).not.toBeNull();
				expect(element?.x, `${label}:${name} left`).toBeGreaterThanOrEqual(0);
				expect(element?.right, `${label}:${name} right`).toBeLessThanOrEqual(metrics.viewport.width);
			}
			const path = testInfo.outputPath(`setup-mobile-${label}.metrics.json`);
			await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`);
			await testInfo.attach(`setup-mobile-${label}-metrics`, { path, contentType: 'application/json' });
			return metrics;
		};

		await page.setViewportSize({ width: 320, height: 667 });
		await page.goto('/');
		await expect(page).toHaveURL(/\/setup$/);
		await page.locator('#username').fill(E2E_ADMIN.username);
		await page.locator('#password').fill('short');
		await page.locator('#confirmPassword').fill('short');
		await page.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
		await collectMetrics('320x667-before-failure');

		const setupRequests: string[] = [];
		page.on('request', (request) => {
			if (request.method() === 'POST' && request.url().endsWith('/api/v1/auth/setup')) {
				setupRequests.push(request.url());
			}
		});
		await page.locator('form button[type="submit"]').click();
		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('alert')).toContainText(/\S+/);
		expect(setupRequests).toEqual([]);
		await collectMetrics('320x667-failure');
		const failureShot = testInfo.outputPath('setup-mobile-320x667-failure.png');
		await page.screenshot({ path: failureShot, fullPage: false, animations: 'disabled', caret: 'hide' });
		await testInfo.attach('setup-mobile-320x667-failure', { path: failureShot, contentType: 'image/png' });

		await page.setViewportSize({ width: 375, height: 812 });
		await page.locator('#password').fill(E2E_ADMIN.password);
		await page.locator('#confirmPassword').fill(E2E_ADMIN.password);
		await page.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
		await collectMetrics('375x812-before-success');
		const successReadyShot = testInfo.outputPath('setup-mobile-375x812-ready.png');
		await page.screenshot({ path: successReadyShot, fullPage: false, animations: 'disabled', caret: 'hide' });
		await testInfo.attach('setup-mobile-375x812-ready', { path: successReadyShot, contentType: 'image/png' });

		const successfulSetupResponse = page.waitForResponse(
			(response) => response.url().endsWith('/api/v1/auth/setup') && response.request().method() === 'POST',
		);
		await page.locator('form button[type="submit"]').click();
		expect((await successfulSetupResponse).status()).toBe(201);
		await expect(page).toHaveURL(/\/login$/);

		const setupStateAfterRegistration = await request.get('/api/v1/auth/needs-setup');
		expect(setupStateAfterRegistration.ok()).toBeTruthy();
		await expect(setupStateAfterRegistration.json()).resolves.toEqual({ needsSetup: false });
	});
});

test('invalid password login stays anonymous and surfaces the real form error', async ({ page, context }) => {
	await page.goto('/login');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('banner')).toHaveCount(0);

	const logo = page.locator('img[src*="logo-small"]').first();
	await expect(logo).toBeVisible();
	const logoResponse = await context.request.get((await logo.getAttribute('src'))!);
	expect(logoResponse.ok()).toBeTruthy();
	expect((await logoResponse.body()).length).toBeLessThan(50_000);
	await page.locator('#username').fill(E2E_ADMIN.username);
	await page.locator('#password').fill('Definitely-Wrong-E2E-Password!');

	const loginResponse = page.waitForResponse(
		(response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
	);
	await page.locator('form button[type="submit"]').click();
	expect((await loginResponse).status()).toBe(401);

	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('alert')).toContainText(/\S+/);
	await expect(page.getByRole('banner')).toHaveCount(0);
	const status = await context.request.get('/api/v1/auth/status');
	expect(status.status()).toBe(401);
});

test('logs in, establishes a server session, and opens the dashboard', async ({ page, context }) => {
	await page.goto('/login');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('banner')).toHaveCount(0);

	await page.locator('#username').fill(E2E_ADMIN.username);
	await page.locator('#password').fill(E2E_ADMIN.password);
	// Authentication state commits before this lazy route finishes loading.
	await page.route(/\/pages\/dashboard\/DashboardPage\.vue(?:\?|$)/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.continue();
	});
	await page.evaluate(() => {
		const samples: LoginTransitionSample[] = [];
		const state = window as Window & {
			__loginTransitionSamples?: LoginTransitionSample[];
			__loginTransitionStopped?: boolean;
		};
		state.__loginTransitionSamples = samples;
		state.__loginTransitionStopped = false;

		const sample = () => {
			samples.push({
				pathname: location.pathname,
				header: Boolean(document.querySelector('header.app-header')),
				login: Boolean(document.querySelector('.auth-page')),
			});
			if (!state.__loginTransitionStopped) requestAnimationFrame(sample);
		};

		requestAnimationFrame(sample);
	});

	const loginResponsePromise = page.waitForResponse(
		(response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
	);
	await page.locator('form button[type="submit"]').click();

	const loginResponse = await loginResponsePromise;
	expect(loginResponse.status()).toBe(200);
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('banner')).toBeVisible();
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
	const transitionSamples = await page.evaluate(() => {
		const state = window as Window & {
			__loginTransitionSamples?: LoginTransitionSample[];
			__loginTransitionStopped?: boolean;
		};
		state.__loginTransitionStopped = true;
		return state.__loginTransitionSamples ?? [];
	});
	expect(
		transitionSamples.some((sample) => sample.pathname === '/login' && sample.login && !sample.header),
	).toBeTruthy();
	expect(transitionSamples.filter((sample) => sample.header && sample.login)).toHaveLength(0);
	expect(transitionSamples.some((sample) => sample.pathname === '/' && sample.header && !sample.login)).toBeTruthy();

	const authStatus = await context.request.get('/api/v1/auth/status');
	expect(authStatus.ok()).toBeTruthy();
	await expect(authStatus.json()).resolves.toMatchObject({
		isAuthenticated: true,
		user: { username: E2E_ADMIN.username },
	});
});

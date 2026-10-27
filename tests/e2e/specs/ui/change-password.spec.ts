import { writeFile } from 'node:fs/promises';
import { dismissToasts } from '../../support/feedback';
import { expect, test, type APIRequestContext, type BrowserContext } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';
import { readPasskeyList } from '../../../../packages/shared/src/access/factors/passkey-codec';
import { ACCESS_PASSKEY_NAME_MAX_BYTES } from '../../../../packages/shared/src/access/values';
const headers = { Origin: E2E_URLS.frontendOrigin };

const TEMP_PASSWORD = 'E2e-Temporary-Password-2026!';

async function login(request: APIRequestContext, password: string): Promise<boolean> {
	const response = await request.post('/api/v1/auth/login', {
		headers,
		data: { username: E2E_ADMIN.username, password, rememberMe: false },
	});
	return response.ok();
}

async function restoreDefaultPassword(request: APIRequestContext): Promise<void> {
	await request.post('/api/v1/auth/logout', { headers }).catch(() => undefined);
	if (await login(request, TEMP_PASSWORD)) {
		const restore = await request.put('/api/v1/auth/password', {
			headers,
			data: { currentPassword: TEMP_PASSWORD, newPassword: E2E_ADMIN.password },
		});
		expect(restore.ok()).toBeTruthy();
		await request.post('/api/v1/auth/logout', { headers });
	}
	if (!(await login(request, E2E_ADMIN.password))) {
		throw new Error('failed to restore the default E2E administrator password');
	}
}

async function addVirtualAuthenticator(context: BrowserContext, page: import('@playwright/test').Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const result = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return { cdp, authenticatorId: result.authenticatorId };
}

test('password change UI updates the real login credential and can restore the test account', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	let passwordChanged = false;

	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		const form = page
			.getByRole('heading', { name: 'Change Password', exact: true })
			.locator('xpath=ancestor::section[1]');
		const currentPassword = form.getByLabel('Current Password:', { exact: true });
		const newPassword = form.getByLabel('New Password:', { exact: true });
		const confirmPassword = form.getByLabel('Confirm New Password:', { exact: true });
		const submit = form.getByRole('button', { name: 'Change Password', exact: true });
		await expect(form).toBeVisible();

		const collectMetrics = async (name: string) => {
			const metrics = await page.evaluate(() => {
				const readRect = (selector: string) => {
					const element = document.querySelector<HTMLElement>(selector);
					if (!element) return null;
					const rect = element.getBoundingClientRect();
					return {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
						right: rect.right,
						bottom: rect.bottom,
					};
				};

				return {
					viewport: { width: window.innerWidth, height: window.innerHeight },
					page: {
						clientWidth: document.documentElement.clientWidth,
						scrollWidth: document.documentElement.scrollWidth,
						bodyClientWidth: document.body.clientWidth,
						bodyScrollWidth: document.body.scrollWidth,
					},
					elements: {
						settings: readRect('section:has(#currentPassword)'),
						current: readRect('#currentPassword'),
						newPassword: readRect('#newPassword'),
						confirm: readRect('#confirmPassword'),
						submit: readRect('section:has(#currentPassword) button[type="submit"]'),
						message: readRect('.ui-notification[data-kind="error"]'),
					},
				};
			});
			await writeFile(
				testInfo.outputPath(`change-password-${name}.metrics.json`),
				JSON.stringify(metrics, null, 2),
			);
			return metrics;
		};

		const beforeMetrics = await collectMetrics('before');
		expect(beforeMetrics.page.scrollWidth).toBeLessThanOrEqual(beforeMetrics.page.clientWidth);
		expect(beforeMetrics.page.bodyScrollWidth).toBeLessThanOrEqual(beforeMetrics.page.bodyClientWidth);
		await captureFunctionalScreenshot(page, 'security-change-password-form.png', {
			viewport: { width: 1440, height: 900 },
		});

		await step('client validation keeps incomplete password submissions local', async () => {
			const requestPromise = page
				.waitForRequest(
					(request) => request.url().endsWith('/api/v1/auth/password') && request.method() === 'PUT',
					{
						timeout: 1_000,
					},
				)
				.catch(() => undefined);
			await expect(submit).toBeDisabled();
			expect(await requestPromise).toBeUndefined();

			await currentPassword.fill(E2E_ADMIN.password);
			await newPassword.fill(TEMP_PASSWORD);
			await confirmPassword.fill(`${TEMP_PASSWORD}-mismatch`);
			const mismatchRequest = page
				.waitForRequest(
					(request) => request.url().endsWith('/api/v1/auth/password') && request.method() === 'PUT',
					{
						timeout: 1_000,
					},
				)
				.catch(() => undefined);
			await submit.click();
			await expect(
				page
					.locator('.ui-notification[data-kind="error"]')
					.filter({ hasText: 'New password and confirmation do not match.' }),
			).toBeVisible();
			expect(await mismatchRequest).toBeUndefined();
			await dismissToasts(page);
		});

		await step('the API rejects a wrong current password and clears secret inputs', async () => {
			await currentPassword.fill('Definitely-Wrong-Current-Password!');
			await confirmPassword.fill(TEMP_PASSWORD);
			const responsePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/auth/password') && response.request().method() === 'PUT',
			);
			await submit.click();
			expect((await responsePromise).status()).toBe(401);
			await expect(
				page
					.locator('.ui-notification[data-kind="error"]')
					.filter({ hasText: 'The username, password or verification code is incorrect.' }),
			).toBeVisible();
			await expect(currentPassword).toHaveValue('');
			await dismissToasts(page);
			await expect(newPassword).toHaveValue('');
			await expect(confirmPassword).toHaveValue('');
		});

		await step('change the administrator password through the security UI', async () => {
			await currentPassword.fill(E2E_ADMIN.password);
			await newPassword.fill(TEMP_PASSWORD);
			await confirmPassword.fill(TEMP_PASSWORD);
			const responsePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/auth/password') && response.request().method() === 'PUT',
			);
			await submit.click();
			expect((await responsePromise).ok()).toBeTruthy();
			passwordChanged = true;
			await expect(page).toHaveURL(/\/login$/);
			await expect(page.locator('#currentPassword')).toHaveCount(0);
			const authenticatedStatus = await context.request.get('/api/v1/auth/status');
			expect(authenticatedStatus.status()).toBe(401);
			expect(await login(context.request, TEMP_PASSWORD)).toBeTruthy();
			const renewedStatus = await context.request.get('/api/v1/auth/status');
			await expect(renewedStatus.json()).resolves.toMatchObject({ isAuthenticated: true });
			// The APIRequestContext login restores the cookie, but does not
			// navigate the browser away from the previous /login screen.
			await page.goto('/settings');
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			await expect(form).toBeVisible();
			await expect(currentPassword).toHaveValue('');
			await expect(newPassword).toHaveValue('');
			await expect(confirmPassword).toHaveValue('');
			const afterMetrics = await collectMetrics('after');
			expect(afterMetrics.page.scrollWidth).toBeLessThanOrEqual(afterMetrics.page.clientWidth);
			expect(afterMetrics.page.bodyScrollWidth).toBeLessThanOrEqual(afterMetrics.page.bodyClientWidth);
			await captureFunctionalScreenshot(page, 'security-change-password-success.png', {
				viewport: { width: 1440, height: 900 },
			});
		});

		await step('the new password authenticates after logout', async () => {
			expect((await context.request.post('/api/v1/auth/logout', { headers })).ok()).toBeTruthy();
			expect(await login(context.request, TEMP_PASSWORD)).toBeTruthy();
			const status = await context.request.get('/api/v1/auth/status');
			await expect(status.json()).resolves.toMatchObject({
				isAuthenticated: true,
				user: { username: E2E_ADMIN.username },
			});
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page).toHaveURL(/\/settings\?tab=security$/);
		});

		await step('restore the standard E2E password for following tests', async () => {
			expect((await context.request.post('/api/v1/auth/logout', { headers })).ok()).toBeTruthy();
			expect(await login(context.request, TEMP_PASSWORD)).toBeTruthy();
			const restore = await context.request.put('/api/v1/auth/password', {
				headers,
				data: { currentPassword: TEMP_PASSWORD, newPassword: E2E_ADMIN.password },
			});
			expect(restore.ok()).toBeTruthy();
			passwordChanged = false;
			expect((await context.request.post('/api/v1/auth/logout', { headers })).ok()).toBeTruthy();
			expect(await login(context.request, E2E_ADMIN.password)).toBeTruthy();
		});
	} finally {
		if (passwordChanged) await restoreDefaultPassword(context.request);
	}
});

test('passkey settings UI registers, renames, reloads, and deletes a real credential', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const { cdp, authenticatorId } = await addVirtualAuthenticator(context, page);

	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		const panel = page
			.getByRole('heading', { name: 'Passkey Management', exact: true })
			.locator('xpath=ancestor::section[1]');
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('No Passkeys registered yet.');
		await panel.scrollIntoViewIfNeeded();

		const collectPasskeyMetrics = async (name: string) => {
			const metrics = await panel.evaluate((panelElement) => {
				const listItem = panelElement.querySelector<HTMLElement>('li');

				const rect = (element: Element | null) => {
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
					},
					panel: rect(panelElement),
					listItem: rect(listItem),
				};
			});
			await writeFile(testInfo.outputPath(`passkey-${name}.metrics.json`), JSON.stringify(metrics, null, 2));
		};

		await collectPasskeyMetrics('before');
		await captureFunctionalScreenshot(page, 'security-passkey-registration-empty.png', {
			viewport: { width: 1440, height: 900 },
		});

		await step('register a passkey through the real Security UI', async () => {
			const optionsPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/auth/passkey/registration-options') &&
					response.request().method() === 'POST',
			);
			const registerPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/auth/passkey/register') && response.request().method() === 'POST',
			);
			await panel.getByRole('button', { name: 'Register New Passkey', exact: true }).click();
			expect((await optionsPromise).ok()).toBeTruthy();
			expect((await registerPromise).status()).toBe(201);
			await expect(panel.locator('li').first()).toContainText('Unnamed Passkey');
		});

		const row = panel.locator('li').first();
		const passkeys = await context.request.get('/api/v1/auth/user/passkeys');
		expect(passkeys.ok()).toBeTruthy();
		const passkeyList = readPasskeyList(await passkeys.json());
		expect(passkeyList).toHaveLength(1);
		const passkey = passkeyList[0];
		if (!passkey) throw new Error('Registered passkey missing');
		expect(passkey).toMatchObject({
			credentialId: expect.any(String),
			name: null,
			transports: expect.any(Array),
			createdAt: expect.any(Number),
			lastUsedAt: null,
		});
		for (const legacyName of ['credential_id', 'created_at', 'last_used_at'])
			expect(passkey).not.toHaveProperty(legacyName);
		const credentialId = passkey.credentialId;
		expect(credentialId).toBeTruthy();
		const renamedPasskeyName = 'E2E Security Key '.padEnd(ACCESS_PASSKEY_NAME_MAX_BYTES, 'x');

		await step(
			'reject an oversized passkey name locally then persist a name at the Shared byte limit',
			async () => {
				await row.getByTitle('Edit').click();
				const nameInput = row.locator('input');
				await nameInput.fill(renamedPasskeyName + 'x');
				let dispatched = 0;

				const countRename = (request: import('@playwright/test').Request) => {
					if (request.url().endsWith('/name') && request.method() === 'PUT') dispatched++;
				};

				page.on('request', countRename);
				try {
					await row.getByRole('button', { name: 'Save', exact: true }).click();
					await expect(
						page
							.locator('.ui-notification[data-kind="error"]')
							.filter({ hasText: 'Check the input format and length.' }),
					).toBeVisible();
					expect(dispatched).toBe(0);
				} finally {
					page.off('request', countRename);
				}
				const unchanged = await context.request.get('/api/v1/auth/user/passkeys');
				expect(unchanged.ok()).toBe(true);
				expect(readPasskeyList(await unchanged.json())[0].name).toBeNull();
				await nameInput.fill(renamedPasskeyName);
				const renamePromise = page.waitForResponse(
					(response) =>
						response.url().endsWith(`/api/v1/auth/user/passkeys/${credentialId}/name`) &&
						response.request().method() === 'PUT',
				);
				await row.getByRole('button', { name: 'Save', exact: true }).click();
				expect((await renamePromise).ok()).toBeTruthy();
				await expect(row).toContainText(renamedPasskeyName);
				const renamed = await context.request.get('/api/v1/auth/user/passkeys');
				expect(readPasskeyList(await renamed.json())).toMatchObject([
					{ credentialId, name: renamedPasskeyName },
				]);
			},
		);

		await step('reload keeps the renamed passkey visible', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'Security', exact: true }).click();
			const reloadedPanel = page
				.getByRole('heading', { name: 'Passkey Management', exact: true })
				.locator('xpath=ancestor::section[1]');
			await expect(reloadedPanel.locator('li').first()).toContainText(renamedPasskeyName);
			await reloadedPanel.scrollIntoViewIfNeeded();
			await collectPasskeyMetrics('after');
			await captureFunctionalScreenshot(page, 'security-passkey-registration-registered.png', {
				viewport: { width: 1440, height: 900 },
			});
		});

		await step('delete the registered passkey and persist the empty state', async () => {
			const reloadedPanel = page
				.getByRole('heading', { name: 'Passkey Management', exact: true })
				.locator('xpath=ancestor::section[1]');
			const deletePromise = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/api/v1/auth/user/passkeys/${credentialId}`) &&
					response.request().method() === 'DELETE',
			);
			await reloadedPanel.locator('li').first().getByRole('button', { name: 'Delete', exact: true }).click();
			expect((await deletePromise).ok()).toBeTruthy();
			await expect(reloadedPanel).toContainText('No Passkeys registered yet.');
			const deleted = await context.request.get('/api/v1/auth/user/passkeys');
			expect(readPasskeyList(await deleted.json())).toEqual([]);
		});
	} finally {
		await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => undefined);
		await cdp.send('WebAuthn.disable').catch(() => undefined);
	}
});

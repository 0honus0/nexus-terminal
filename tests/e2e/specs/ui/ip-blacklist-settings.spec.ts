import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';
import { E2E_ADMIN } from '../../support/test-identity';
import { E2E_URLS } from '../../support/test-env';
import { getTestSettings, updateTestSettings, restartTestBackend } from '../../support/settings';
import { readAccessIpBlacklist, readAccessIpBlacklistRemove } from '../../../../packages/shared/src/access/http';

const TEST_BLOCKED_IP = '198.51.100.24';
const headers = { Origin: E2E_URLS.frontendOrigin };

test('IP blacklist UI saves policy, activates it after restart, and removes a blocked IP', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const original = await getTestSettings(context.request);
	await updateTestSettings(context.request, (value) => {
		value.policy.ipBlacklistEnabled = true;
		value.policy.maxLoginAttempts = 5;
		value.policy.loginBanDuration = 300;
	});
	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
		const blacklist = page
			.locator('section.ui-solid-panel')
			.filter({ has: page.getByRole('heading', { name: 'IP Blacklist Management', exact: true }) });
		// UiCheckbox renders through Reka CheckboxRoot; use the public control
		// marker instead of assuming the primitive retains a custom switch role.
		const toggle = blacklist.locator('[data-ui="checkbox"]').first();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await blacklist.scrollIntoViewIfNeeded();
		const metrics = await blacklist.evaluate((element) => {
			const box = element.getBoundingClientRect();
			return {
				viewport: { width: innerWidth, height: innerHeight },
				page: {
					clientWidth: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
				},
				panel: {
					x: box.x,
					y: box.y,
					width: box.width,
					height: box.height,
					right: box.right,
					bottom: box.bottom,
				},
			};
		});
		await writeFile(testInfo.outputPath('ip-blacklist-before.metrics.json'), JSON.stringify(metrics, null, 2));
		await captureFunctionalScreenshot(page, 'security-ip-blacklist-settings.png', {
			viewport: { width: 1440, height: 900 },
		});
		await page.setViewportSize({ width: 320, height: 667 });
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
			)
			.toBe(true);
		await captureFunctionalScreenshot(page, 'security-ip-blacklist-settings-narrow.png');
		await page.setViewportSize({ width: 1280, height: 720 });

		async function savePolicy(button: import('@playwright/test').Locator): Promise<void> {
			const response = page.waitForResponse(
				(value) => value.url().endsWith('/api/v1/settings') && value.request().method() === 'PUT',
			);
			await button.click();
			expect((await response).ok()).toBe(true);
			await expect(button).toBeEnabled();
		}

		await step('toggle saves only its own field and preserves neighbouring drafts', async () => {
			const before = await getTestSettings(context.request);
			await blacklist.locator('#maxLoginAttempts').fill('3');
			await blacklist.locator('#loginBanDuration').fill('360');
			await savePolicy(toggle);
			await expect(toggle).toHaveAttribute('aria-checked', 'false');
			await expect(blacklist.locator('#maxLoginAttempts')).toHaveCount(0);
			const disabled = await getTestSettings(context.request);
			expect(disabled.version).toBe(before.version + 1);
			expect(disabled.policy).toEqual({ ...before.policy, ipBlacklistEnabled: false });
			await savePolicy(toggle);
			const enabled = await getTestSettings(context.request);
			expect(enabled.version).toBe(disabled.version + 1);
			expect(enabled.policy).toEqual(before.policy);
			await expect(blacklist.locator('#maxLoginAttempts')).toHaveValue('3');
			await expect(blacklist.locator('#loginBanDuration')).toHaveValue('360');
		});
		await step('invalid thresholds do not dispatch a policy mutation', async () => {
			const before = await getTestSettings(context.request);
			const form = blacklist.locator('form');
			await blacklist.locator('#maxLoginAttempts').fill('0');
			await form.locator('button[type="submit"]').click();
			expect(
				await blacklist
					.locator('#maxLoginAttempts')
					.evaluate((input: HTMLInputElement) => input.validity.valid),
			).toBe(false);
			expect((await getTestSettings(context.request)).version).toBe(before.version);
			await blacklist.locator('#maxLoginAttempts').fill('5');
			await blacklist.locator('#loginBanDuration').fill('0');
			await form.locator('button[type="submit"]').click();
			expect(
				await blacklist
					.locator('#loginBanDuration')
					.evaluate((input: HTMLInputElement) => input.validity.valid),
			).toBe(false);
			expect((await getTestSettings(context.request)).version).toBe(before.version);
		});
		await step('save thresholds without falsely claiming the new policy is active', async () => {
			await blacklist.locator('#maxLoginAttempts').fill('2');
			await blacklist.locator('#loginBanDuration').fill('420');
			await savePolicy(blacklist.locator('form button[type="submit"]'));
			const saved = await getTestSettings(context.request);
			expect(saved.policy).toMatchObject({ maxLoginAttempts: 2, loginBanDuration: 420 });
			expect(saved.effectiveVersion).toBe(original.effectiveVersion);
			expect(saved.requiresRestart).toBe(true);
		});
		await step('activate durable policy, produce a real ban, and remove it through the UI', async () => {
			await restartTestBackend();
			await loginAsInitialAdmin(context.request);
			const active = await getTestSettings(context.request);
			expect(active.effectiveVersion).toBe(active.version);
			expect(active.requiresRestart).toBe(false);
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const failed = await context.request.post('/api/v1/auth/login', {
					headers: { ...headers, 'X-Forwarded-For': TEST_BLOCKED_IP },
					data: { username: E2E_ADMIN.username, password: 'not-the-password', rememberMe: false },
				});
				expect(failed.status()).toBe(401);
			}
			const response = await context.request.get('/api/v1/settings/ip-blacklist');
			expect(response.ok()).toBe(true);
			expect(readAccessIpBlacklist(await response.json()).entries).toEqual([
				expect.objectContaining({ ip: TEST_BLOCKED_IP, attempts: 2 }),
			]);
			await page.reload();
			await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
			const row = blacklist.locator('tbody tr').filter({ hasText: TEST_BLOCKED_IP });
			await expect(row).toBeVisible();
			const removed = page.waitForResponse(
				(value) =>
					value.url().endsWith('/api/v1/settings/ip-blacklist') && value.request().method() === 'DELETE',
			);
			await row.getByRole('button', { name: 'Remove', exact: true }).click();
			// Removing a banned address is a destructive security mutation;
			// the owner intentionally waits for a separate user confirmation.
			const confirm = page.getByRole('dialog', { name: 'Please confirm' });
			await expect(confirm).toContainText(TEST_BLOCKED_IP);
			await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
			const result = await removed;
			expect(result.ok()).toBe(true);
			// The Settings panel reloads after removal, which can retire the
			// browser-owned DELETE body. Confirm the original 2xx receipt and
			// independently verify the ban is absent in the persisted list.
			const persisted = await context.request.get('/api/v1/settings/ip-blacklist');
			expect(persisted.ok()).toBe(true);
			expect(
				readAccessIpBlacklist(await persisted.json()).entries.some((entry) => entry.ip === TEST_BLOCKED_IP),
			).toBe(false);
			await expect(blacklist).toContainText('No IP addresses are currently in the blacklist.');
		});
		await page.reload();
		await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
		await expect(blacklist.locator('#maxLoginAttempts')).toHaveValue('2');
		await expect(blacklist.locator('#loginBanDuration')).toHaveValue('420');
		await captureFunctionalScreenshot(page, 'security-ip-blacklist-updated.png', {
			viewport: { width: 1440, height: 900 },
		});
	} finally {
		const failures: unknown[] = [];
		try {
			await updateTestSettings(context.request, (value) => {
				value.policy.ipBlacklistEnabled = original.policy.ipBlacklistEnabled;
				value.policy.maxLoginAttempts = original.policy.maxLoginAttempts;
				value.policy.loginBanDuration = original.policy.loginBanDuration;
			});
		} catch (cause) {
			failures.push(cause);
		}
		try {
			const removed = await context.request.delete('/api/v1/settings/ip-blacklist', {
				headers,
				data: { ip: TEST_BLOCKED_IP },
			});
			expect(removed.ok()).toBe(true);
			readAccessIpBlacklistRemove(await removed.json());
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length) throw new AggregateError(failures, 'IP policy cleanup failed');
	}
});

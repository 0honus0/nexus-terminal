import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step } from '../../support/steps';

import { getTestSettings, updateTestSettings } from '../../support/settings';

const WHITELIST = '127.0.0.1\n10.0.0.0/8\n192.168.0.0/16';

test('IP whitelist UI applies and reloads the configured allow-list without restart', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const original = await getTestSettings(context.request);

	try {
		await page.goto('/settings');
		await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
		const whitelist = page.locator('section.ui-settings-group').filter({ has: page.locator('#ipWhitelist') });
		await expect(whitelist).toBeVisible();
		await whitelist.scrollIntoViewIfNeeded();
		const beforeMetrics = await whitelist.evaluate((element) => {
			const box = element.getBoundingClientRect();
			const input = element.querySelector('textarea')?.getBoundingClientRect();
			return {
				viewport: { width: window.innerWidth, height: window.innerHeight },
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
				input: input
					? {
							x: input.x,
							y: input.y,
							width: input.width,
							height: input.height,
							right: input.right,
							bottom: input.bottom,
						}
					: null,
			};
		});
		await writeFile(
			testInfo.outputPath('ip-whitelist-before.metrics.json'),
			JSON.stringify(beforeMetrics, null, 2),
		);
		await captureFunctionalScreenshot(page, 'security-ip-whitelist-settings.png', {
			viewport: { width: 1440, height: 900 },
		});
		await page.setViewportSize({ width: 320, height: 667 });
		await expect
			.poll(() =>
				page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
			)
			.toBe(true);
		await captureFunctionalScreenshot(page, 'security-ip-whitelist-settings-narrow.png');
		await page.setViewportSize({ width: 1280, height: 720 });

		await step('save a multi-line whitelist through the IP control UI', async () => {
			await whitelist.locator('#ipWhitelist').fill(WHITELIST);
			const responsePromise = page.waitForResponse((response) => {
				if (!response.url().endsWith('/api/v1/settings') || response.request().method() !== 'PUT') return false;
				try {
					const body = response.request().postDataJSON() as { policy?: { ipWhitelist?: unknown } };
					return body.policy?.ipWhitelist === WHITELIST;
				} catch {
					return false;
				}
			});
			await whitelist.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();
			await expect(page.locator('.ui-notification[data-kind="success"]').last()).toContainText(
				'Saved and applied.',
			);
			const persisted = await getTestSettings(context.request);
			expect(persisted.policy.ipWhitelist).toBe(WHITELIST);
			expect(persisted.effectiveVersion).toBe(
				original.requiresRestart ? original.effectiveVersion : persisted.version,
			);
			expect(persisted.requiresRestart).toBe(original.requiresRestart);
			const blocked = await context.request.get('/api/v1/status', {
				headers: { 'X-Forwarded-For': '203.0.113.24' },
			});
			expect(blocked.status()).toBe(403);
			expect(await blocked.json()).toEqual({ code: 'forbidden' });
		});

		await step('reload keeps the saved whitelist visible', async () => {
			await page.reload();
			await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
			await expect(page.locator('#ipWhitelist')).toHaveValue(WHITELIST);
		});

		await step('clear the whitelist through the UI and persist the empty allow-list', async () => {
			const reloadedWhitelist = page
				.locator('section.ui-settings-group')
				.filter({ has: page.locator('#ipWhitelist') });
			await reloadedWhitelist.locator('#ipWhitelist').fill('');
			const responsePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
			);
			await reloadedWhitelist.getByRole('button', { name: 'Save', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();
			await expect(page.locator('.ui-notification[data-kind="success"]').last()).toContainText(
				'Saved and applied.',
			);
			const persisted = await getTestSettings(context.request);
			expect(persisted.policy.ipWhitelist).toBe('');
			const allowed = await context.request.get('/api/v1/status', {
				headers: { 'X-Forwarded-For': '203.0.113.24' },
			});
			expect(allowed.ok()).toBe(true);
			expect(persisted.effectiveVersion).toBe(
				original.requiresRestart ? original.effectiveVersion : persisted.version,
			);
			expect(persisted.requiresRestart).toBe(original.requiresRestart);
			await page.reload();
			await page.getByRole('tab', { name: 'IP Control', exact: true }).click();
			await expect(page.locator('#ipWhitelist')).toHaveValue('');
		});
	} finally {
		await updateTestSettings(context.request, (value) => {
			value.policy.ipWhitelist = original.policy.ipWhitelist;
		});
	}
});

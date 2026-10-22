import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_SSH } from '../../support/ssh';
import { selectUiOption } from '../../support/ui-select';

import {
	listTestNotifications,
	createTestNotification,
	removeTestNotification,
	deliverTestNotification,
} from '../../support/notifications';

const CHANNEL_NAME = 'E2E Webhook Channel';

test('webhook secrets are redacted and kept, replaced, or cleared by explicit UI actions', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await cleanupChannel(context.request);

	const url = (phase: string) => E2E_SSH.controlUrl + '/e2e-notification-webhook-secrets?phase=' + phase;

	const created = await createTestNotification(context.request, {
		name: CHANNEL_NAME,
		enabled: false,
		events: [],
		config: {
			kind: 'webhook',
			url: url('original'),
			method: 'POST',
			bodyTemplate: '{"event":"{event}"}',
			headers: [
				{ name: 'Authorization', value: { action: 'replace', value: 'Bearer e2e-original' } },
				{ name: 'X-E2E-Private', value: { action: 'replace', value: 'private-original' } },
				{ name: 'X-Public', value: { action: 'replace', value: 'visible' } },
			],
		},
	});
	try {
		await page.goto('/notifications');
		for (const phase of ['original', 'replacement', 'removed']) {
			await step('Webhook secret edit ' + phase + ' uses the expected outbound credentials', async () => {
				const card = page.locator('[data-notification-id="' + created.id + '"]');
				await card.getByRole('button', { name: 'Edit', exact: true }).click();
				const form = page.locator('form').filter({ has: page.locator('#setting-name') });
				await expect(form.getByLabel('New secret value', { exact: true })).toHaveCount(0);
				await page.locator('#webhook-url').fill(url(phase));
				if (phase !== 'original') {
					for (const headerName of ['Authorization', 'X-E2E-Private']) {
						const nameInput = form.getByRole('textbox', { name: 'Header name', exact: true });
						const index = (
							await nameInput.evaluateAll((elements) =>
								elements.map((element) => (element as HTMLInputElement).value),
							)
						).indexOf(headerName);
						expect(index).toBeGreaterThanOrEqual(0);
						const header = nameInput.nth(index).locator('xpath=ancestor::div[contains(@class, "grid")][1]');
						await selectUiOption(
							header.getByRole('combobox', { name: 'Secret action', exact: true }),
							phase === 'removed' ? 'clear' : 'replace',
						);
						if (phase === 'replacement')
							await header
								.getByLabel('New secret value', { exact: true })
								.fill(
									headerName === 'Authorization' ? 'Bearer e2e-replacement' : 'private-replacement',
								);
					}
				}
				await form.getByRole('button', { name: 'Save', exact: true }).click();
				await expect(page.locator('#setting-name')).toHaveCount(0);
				const saved = (await listTestNotifications(context.request)).find((item) => item.id === created.id);
				if (!saved || saved.config.kind !== 'webhook') throw new Error('Missing webhook');
				for (const secret of ['Bearer e2e-', 'private-original', 'private-replacement', 'visible'])
					expect(JSON.stringify(saved)).not.toContain(secret);
				expect(
					saved.config.headers.filter((header) => ['Authorization', 'X-E2E-Private'].includes(header.name)),
				).toEqual([
					{ name: 'Authorization', hasValue: phase !== 'removed' },
					{ name: 'X-E2E-Private', hasValue: phase !== 'removed' },
				]);
				await deliverTestNotification(context.request, saved.id);
			});
		}
	} finally {
		await cleanupChannel(context.request);
	}
});

async function cleanupChannel(request: APIRequestContext): Promise<void> {
	const items = (await listTestNotifications(request)).filter((item) => item.name === CHANNEL_NAME);
	const results = await Promise.allSettled(items.map((item) => removeTestNotification(request, item)));
	const failures = results.filter((item) => item.status === 'rejected').map((item) => item.reason);
	if (failures.length) throw new AggregateError(failures, 'Notification cleanup failed');
}

test('notification settings create, edit, persist, and delete a webhook channel through the UI', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await cleanupChannel(context.request);
	await page.goto('/notifications');

	const settings = page.getByRole('heading', { name: 'Notification Settings', exact: true }).locator('..');
	await expect(settings).toBeVisible({ timeout: 20_000 });

	await step('add a webhook notification channel', async () => {
		await settings.getByRole('button', { name: 'Add Notification Channel', exact: true }).click();
		await page.locator('#setting-name').fill(CHANNEL_NAME);
		await selectUiOption(page.locator('#setting-channel-type'), 'webhook');
		await page.locator('#webhook-url').fill(`${E2E_SSH.controlUrl}/e2e-notification-webhook`);
		await selectUiOption(page.locator('#webhook-method'), 'POST');
		await page.locator('#webhook-body').fill('{"event":"{event}"}');
		await page
			.locator('form')
			.filter({ has: page.locator('#setting-name') })
			.getByRole('button', { name: 'Save', exact: true })
			.click();

		const card = settings.locator('[data-notification-id]').filter({ hasText: CHANNEL_NAME });
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(card).toContainText('Webhook');
		await expect(card).toContainText('Enabled');
	});

	await step('edit the channel and persist the disabled state', async () => {
		const card = settings.locator('[data-notification-id]').filter({ hasText: CHANNEL_NAME });
		await card.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.locator('#setting-name')).toHaveValue(CHANNEL_NAME);
		await page.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
		await page
			.locator('form')
			.filter({ has: page.locator('#setting-name') })
			.getByRole('button', { name: 'Save', exact: true })
			.click();
		await expect(card).toContainText('Disabled');

		const saved = (await listTestNotifications(context.request)).find((item) => item.name === CHANNEL_NAME);
		expect(saved).toMatchObject({ name: CHANNEL_NAME, enabled: false });
	});

	await step('delete the channel and remove it from persistent settings', async () => {
		const card = settings.locator('[data-notification-id]').filter({ hasText: CHANNEL_NAME });
		await card.getByRole('button', { name: 'Delete', exact: true }).click();
		const confirm = page.getByRole('dialog').filter({ hasText: CHANNEL_NAME });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect(card).toHaveCount(0);

		expect((await listTestNotifications(context.request)).some((item) => item.name === CHANNEL_NAME)).toBe(false);
	});
});

test('notification settings keep long provider and event content readable on a narrow screen', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);

	const longName = 'E2E Notification Channel With An Extremely Long Narrow Screen Name';
	const longUrl = `${E2E_SSH.controlUrl}/e2e-notification-provider-with-a-long-path-for-mobile-readability`;
	await createTestNotification(context.request, {
		name: longName,
		enabled: true,
		events: [
			'LOGIN_SUCCESS',
			'PASSKEY_AUTH_SUCCESS',
			'NOTIFICATION_SETTING_UPDATED',
			'SSH_CONNECT_FAILURE',
			'ADMIN_SETUP_COMPLETE',
		],
		config: {
			kind: 'webhook',
			url: longUrl,
			method: 'POST',
			headers: [{ name: 'X-E2E-Long-Header', value: { action: 'replace', value: 'narrow' } }],
			bodyTemplate: '{"event":"{event}","subject":"{subjectId}"}',
		},
	});
	await page.setViewportSize({ width: 320, height: 667 });
	await page.goto('/notifications');
	const settings = page.getByRole('heading', { name: 'Notification Settings', exact: true }).locator('..');
	const card = settings.locator('[data-notification-id]').filter({ hasText: longName });
	await expect(card).toBeVisible({ timeout: 15_000 });
	await page.screenshot({ path: testInfo.outputPath('notifications-narrow-after.png'), fullPage: true });

	const metrics = await page.evaluate(() => ({
		viewportWidth: document.documentElement.clientWidth,
		pageScrollWidth: document.documentElement.scrollWidth,
		bodyScrollWidth: document.body.scrollWidth,
		appBackground: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
	}));
	console.log(
		`[M07.02-a metrics] card viewport=${metrics.viewportWidth} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} appBackground=${metrics.appBackground}`,
	);
	expect(metrics.appBackground).toBe('#ffffff');
	expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
	await expect(card.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
	await card.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.locator('#webhook-url')).toHaveValue(longUrl);
	await expect(page.locator('#webhook-body')).toBeVisible();
	await expect(page.locator('#setting-name')).toHaveValue(longName);
	const editMetrics = await page.evaluate(() => {
		const viewportWidth = document.documentElement.clientWidth;
		const form = document.querySelector('form');
		const save = Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent?.trim() === 'Save',
		);
		const saveRect = save?.getBoundingClientRect();
		const labels = Array.from(form?.querySelectorAll('label') ?? []).map(
			(label) => label.getBoundingClientRect().right,
		);
		return {
			viewportWidth,
			pageScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
			pageClientHeight: document.scrollingElement?.clientHeight ?? 0,
			maxLabelRight: labels.length ? Math.max(...labels) : 0,
			saveRight: saveRect?.right ?? 0,
		};
	});
	console.log(
		`[M07.02-a edit metrics] scrollHeight=${editMetrics.pageScrollHeight} clientHeight=${editMetrics.pageClientHeight} maxLabelRight=${editMetrics.maxLabelRight} saveRight=${editMetrics.saveRight}`,
	);
	expect(editMetrics.maxLabelRight).toBeLessThanOrEqual(editMetrics.viewportWidth);
	await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('notifications-narrow-edit-after.png'), fullPage: true });
});

test('notification settings empty and error states stay within a narrow viewport', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	for (const setting of await listTestNotifications(context.request))
		await removeTestNotification(context.request, setting);

	await page.setViewportSize({ width: 320, height: 667 });
	await page.goto('/notifications');
	const settings = page.getByRole('heading', { name: 'Notification Settings', exact: true }).locator('..');
	await expect(settings.getByText('No notification channels configured yet.', { exact: true })).toBeVisible();
	const emptyMetrics = await page.evaluate(() => ({
		viewportWidth: document.documentElement.clientWidth,
		pageScrollWidth: document.documentElement.scrollWidth,
	}));
	expect(emptyMetrics.pageScrollWidth).toBeLessThanOrEqual(emptyMetrics.viewportWidth);

	await page.route('**/api/v1/settings/notifications', (route) => route.abort('failed'));
	await page.reload();
	await expect(
		page
			.locator('.ui-notification[data-kind="error"]')
			.filter({ hasText: 'The connection is unstable or the service is unavailable.' }),
	).toBeVisible();
	await expect(settings.getByRole('button', { name: 'Add Notification Channel', exact: true })).toHaveCount(0);
	await expect(settings.getByRole('button', { name: 'Refresh and review', exact: true })).toBeEnabled();
	const errorMetrics = await page.evaluate(() => ({
		viewportWidth: document.documentElement.clientWidth,
		pageScrollWidth: document.documentElement.scrollWidth,
	}));
	expect(errorMetrics.pageScrollWidth).toBeLessThanOrEqual(errorMetrics.viewportWidth);
});

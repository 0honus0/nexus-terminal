import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage, updateUiPreferences } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_SSH } from '../../support/ssh';
import { E2E_PORTS } from '../../support/test-env';
import { selectUiOption } from '../../support/ui-select';
import {
	listTestNotifications,
	removeTestNotification,
	waitForTestDelivery,
	NOTIFICATIONS_PATH,
} from '../../support/notifications';
import { readNotificationDeliveries } from '../../../../packages/shared/src/operations/http-codec';
import type { NotificationDeliveryView } from '../../../../packages/shared/src/operations/notifications/model';

const CRUD_CHANNEL_NAME = 'E2E Notification CRUD Delivery';
const STRICT_WEBHOOK_URL = `${E2E_SSH.controlUrl}/e2e-notification-webhook-strict`;
const FAILURE_WEBHOOK_URL = `${E2E_SSH.controlUrl}/e2e-notification-webhook-missing`;
const TEMPLATE = '{"source":"nexus-e2e","event":"{event}","subject":"{subjectId}","time":"{time}"}';

async function webhookForm(page: Page, name: string): Promise<void> {
	await page.goto('/notifications');
	await page.getByRole('button', { name: /^(Add Notification Channel|添加通知渠道)$/, exact: true }).click();
	await page.locator('#setting-name').fill(name);
	await page.locator('#webhook-url').fill(STRICT_WEBHOOK_URL);
	await selectUiOption(page.locator('#webhook-method'), 'POST');
	for (const [name, value] of [
		['Content-Type', 'application/json'],
		['X-E2E-Webhook', 'delivery'],
	]) {
		await page.getByRole('button', { name: /^(Add header|添加 Header)$/ }).click();
		await page
			.getByLabel(/^(Header name|Header 名称)$/, { exact: true })
			.last()
			.fill(name);
		await page
			.getByLabel(/^(New secret value|新秘密值)$/, { exact: true })
			.last()
			.fill(value);
	}
	await page.locator('#webhook-body').fill(TEMPLATE);
}

async function trigger(page: Page, path: string) {
	const request = page.context().request;

	const listDeliveries = async (): Promise<NotificationDeliveryView[]> => {
		const result = await request.get('/api/v1/settings/notification-deliveries?limit=100&offset=0');
		expect(result.status()).toBe(200);
		return readNotificationDeliveries(await result.json()).items;
	};

	const previousIds = new Set((await listDeliveries()).map((item) => item.id));
	const settingId = path.endsWith('/test-unsaved')
		? null
		: path.slice(NOTIFICATIONS_PATH.length + 1, -'/test'.length);
	const pending = page.waitForResponse(
		(response) => response.url().endsWith(path) && response.request().method() === 'POST',
	);
	await page
		.getByRole('button', {
			name: /^(Test Notification|Test saved configuration|测试通知|测试已保存配置)$/,
			exact: true,
		})
		.click();
	const response = await pending;
	expect(response.ok()).toBe(true);
	// Navigation can lose the CDP response body, but the accepted delivery is
	// durable. Do not trigger the webhook a second time merely to read its ID.
	let delivery: NotificationDeliveryView | undefined;
	await expect
		.poll(async () => {
			const matches = (await listDeliveries()).filter(
				(item) =>
					!previousIds.has(item.id) && item.settingId === settingId && item.event === 'SETTINGS_UPDATED',
			);
			if (matches.length === 1) delivery = matches[0];
			return matches.length;
		})
		.toBe(1);
	if (!delivery) throw new Error('Accepted notification delivery is missing');
	expect(delivery.event).toBe('SETTINGS_UPDATED');
	expect(['queued', 'dispatched', 'sent', 'failed', 'unknown']).toContain(delivery.status);
	return delivery;
}

test('notification test button submits the real webhook and confirms its final delivery record', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await webhookForm(page, 'E2E Unsaved Webhook Delivery');
	const delivery = await trigger(page, NOTIFICATIONS_PATH + '/test-unsaved');
	expect(delivery.settingId).toBeNull();
	await waitForTestDelivery(context.request, delivery.id, 'sent');
	expect(
		(await listTestNotifications(context.request)).some((item) => item.name === 'E2E Unsaved Webhook Delivery'),
	).toBe(false);
});

test('notification UI localizes delivery status while preserving the wire event id', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request, 'zh-CN');
	await webhookForm(page, 'E2E Localized Webhook Delivery');
	const delivery = await trigger(page, NOTIFICATIONS_PATH + '/test-unsaved');
	expect(delivery.event).toBe('SETTINGS_UPDATED');
	const translations: Record<typeof delivery.status, string> = {
		queued: '已排队',
		dispatched: '已派发，等待结果',
		sent: '已发送',
		failed: '发送失败',
		unknown: '投递结果未知，请核对接收端后再操作',
	};
	// The durable delivery list may advance from queued to sent *after* the
	// POST returns but before the read-back. The form still owns its original
	// accepted receipt; only the refreshed ledger may claim final delivery.
	await expect(
		page.locator('.ui-notification[data-kind="info"]').filter({ hasText: translations.queued }),
	).toBeVisible();
	await waitForTestDelivery(context.request, delivery.id, 'sent');
	await page.getByRole('button', { name: '取消', exact: true }).click();
	await expect(page.locator('[data-delivery-id]')).toHaveCount(0);
	await page.goto('/audit-logs');
	await page.getByRole('tab', { name: '通知投递', exact: true }).click();
	await expect(page.locator('[data-delivery-id="' + delivery.id + '"]')).toContainText('已发送');
});

test('email notification sends a plain-text template through the real SMTP receiver', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	await page.goto('/notifications');
	await page.getByRole('button', { name: 'Add Notification Channel', exact: true }).click();
	await page.locator('#setting-name').fill('E2E Plain Text Email Delivery');
	await selectUiOption(page.locator('#setting-channel-type'), 'email');
	await page.locator('#notification-to').fill('recipient@example.test');
	await page.locator('#notification-from').fill('nexus@example.test');
	await page.locator('#notification-host').fill('127.0.0.1');
	await page.locator('#notification-port').fill(String(E2E_PORTS.smtp));
	await page.getByRole('checkbox', { name: 'Use TLS/SSL', exact: true }).uncheck();
	await page.locator('#notification-body').fill('NEXUS-E2E-TEXT {event} {time}');
	const delivery = await trigger(page, NOTIFICATIONS_PATH + '/test-unsaved');
	await waitForTestDelivery(context.request, delivery.id, 'sent');
});

test('notification CRUD persists events and exposes a failed delivery without rewriting the channel', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await updateUiPreferences(context.request, (value) => {
		value.language = 'en-US';
		value.timezone = 'UTC';
	});
	for (const item of (await listTestNotifications(context.request)).filter((item) => item.name === CRUD_CHANNEL_NAME))
		await removeTestNotification(context.request, item);
	try {
		await page.setViewportSize({ width: 1280, height: 800 });
		await webhookForm(page, CRUD_CHANNEL_NAME);
		await step('create a channel with explicit event subscriptions', async () => {
			await page.getByLabel('Login Success', { exact: true }).check();
			await page.getByLabel('SSH Connection Failed', { exact: true }).check();
			const pending = page.waitForResponse(
				(response) => response.url().endsWith(NOTIFICATIONS_PATH) && response.request().method() === 'POST',
			);
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			const response = await pending;
			expect(response.status()).toBe(200);
			// The editor can navigate after a successful POST and retire the
			// browser-owned response body. Verify exactly one persisted channel
			// instead of issuing a second non-idempotent create.
			const matches = (await listTestNotifications(context.request)).filter(
				(item) => item.name === CRUD_CHANNEL_NAME,
			);
			expect(matches).toHaveLength(1);
			const created = matches[0]!;
			expect(created).toMatchObject({
				enabled: true,
				events: ['LOGIN_SUCCESS', 'SSH_CONNECT_FAILURE'],
				config: { kind: 'webhook', url: STRICT_WEBHOOK_URL, method: 'POST' },
			});
		});
		const card = page.locator('[data-notification-id]').filter({ hasText: CRUD_CHANNEL_NAME });
		await page.reload();
		await expect(card).toContainText('Enabled');
		await expect(card).toContainText('2 events enabled');
		await card.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByRole('checkbox', { name: 'Enabled', exact: true })).toBeChecked();
		await expect(page.getByLabel('Login Success', { exact: true })).toBeChecked();
		await expect(page.getByLabel('SSH Connection Failed', { exact: true })).toBeChecked();
		const saved = (await listTestNotifications(context.request)).find((item) => item.name === CRUD_CHANNEL_NAME);
		if (!saved) throw new Error('Missing saved notification');
		const successful = await trigger(page, NOTIFICATIONS_PATH + '/' + saved.id + '/test');
		await waitForTestDelivery(context.request, successful.id, 'sent');
		await step('failed delivery remains observable and does not change the saved version', async () => {
			await page.locator('#webhook-url').fill(FAILURE_WEBHOOK_URL);
			const pending = page.waitForResponse(
				(response) =>
					response.url().endsWith(NOTIFICATIONS_PATH + '/' + saved.id) &&
					response.request().method() === 'PUT',
			);
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			const response = await pending;
			expect(response.ok()).toBe(true);
			const matches = (await listTestNotifications(context.request)).filter((item) => item.id === saved.id);
			expect(matches).toHaveLength(1);
			const updated = matches[0]!;
			expect(updated.version).toBe(saved.version + 1);
			await expect(page.locator('#setting-name')).toHaveCount(0);
			await card.getByRole('button', { name: 'Edit', exact: true }).click();
			const failed = await trigger(page, NOTIFICATIONS_PATH + '/' + saved.id + '/test');
			await waitForTestDelivery(context.request, failed.id, 'failed');
			expect((await listTestNotifications(context.request)).find((item) => item.id === saved.id)).toEqual(
				updated,
			);
			await page.getByRole('button', { name: 'Cancel', exact: true }).click();
			await page.goto('/audit-logs');
			await page.getByRole('tab', { name: 'Notification deliveries', exact: true }).click();
			const row = page.locator('[data-delivery-id="' + failed.id + '"]');
			await expect(row).toContainText('Failed');
			await expect(row).not.toContainText(FAILURE_WEBHOOK_URL);
			await page.goto('/notifications');
		});
		await card.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(card).toContainText('Disabled');
		await page.reload();
		await expect(card).toContainText('Disabled');
		await card.getByRole('button', { name: 'Delete', exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect(card).toHaveCount(0);
		expect((await listTestNotifications(context.request)).some((item) => item.id === saved.id)).toBe(false);
		const metrics = await page.evaluate(() => ({
			width: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
			language: document.documentElement.lang,
		}));
		expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
		expect(metrics.language).toBe('en-US');
		await writeFile(
			testInfo.outputPath('notification-crud-delivery-after.metrics.json'),
			JSON.stringify(metrics, null, 2),
		);
		await page.screenshot({ path: testInfo.outputPath('notification-crud-delivery-after.png'), fullPage: true });
	} finally {
		const results = await Promise.allSettled(
			(await listTestNotifications(context.request))
				.filter((item) => item.name === CRUD_CHANNEL_NAME)
				.map((item) => removeTestNotification(context.request, item)),
		);
		const failures = results.filter((item) => item.status === 'rejected').map((item) => item.reason);
		if (failures.length) throw new AggregateError(failures, 'Notification CRUD cleanup failed');
	}
});

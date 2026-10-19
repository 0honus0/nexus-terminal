import { expect, type APIRequestContext } from '@playwright/test';
import {
	readNotificationCreate,
	readNotificationList,
	readNotificationResponse,
	readNotificationDeleteResponse,
	readNotificationTestResponse,
	readNotificationDeliveries,
} from '../../../packages/shared/src/operations/http-codec';
import type { NotificationCreateRequest } from '../../../packages/shared/src/operations/notifications/http';
import type { NotificationSettingView } from '../../../packages/shared/src/operations/notifications/model';
import { E2E_URLS } from './test-env';

export const NOTIFICATIONS_PATH = '/api/v1/settings/notifications';

export const notificationHeaders = { Origin: E2E_URLS.frontendOrigin };

export async function listTestNotifications(request: APIRequestContext): Promise<NotificationSettingView[]> {
	const response = await request.get(NOTIFICATIONS_PATH);
	expect(response.ok()).toBe(true);
	return readNotificationList(await response.json()).items;
}

export async function createTestNotification(
	request: APIRequestContext,
	input: NotificationCreateRequest,
): Promise<NotificationSettingView> {
	const response = await request.post(NOTIFICATIONS_PATH, {
		headers: notificationHeaders,
		data: readNotificationCreate(input),
	});
	expect(response.status()).toBe(200);
	return readNotificationResponse(await response.json()).setting;
}

export async function removeTestNotification(
	request: APIRequestContext,
	setting: NotificationSettingView,
): Promise<void> {
	const response = await request.delete(NOTIFICATIONS_PATH + '/' + setting.id, {
		headers: notificationHeaders,
		data: { expectedVersion: setting.version },
	});
	expect(response.ok()).toBe(true);
	readNotificationDeleteResponse(await response.json());
}

export async function deliverTestNotification(request: APIRequestContext, id: string): Promise<void> {
	const response = await request.post(NOTIFICATIONS_PATH + '/' + id + '/test', {
		headers: notificationHeaders,
		data: {},
	});
	expect(response.ok()).toBe(true);
	const delivery = readNotificationTestResponse(await response.json()).delivery;
	expect(delivery.settingId).toBe(id);
	await waitForTestDelivery(request, delivery.id, 'sent');
}

export async function waitForTestDelivery(
	request: APIRequestContext,
	id: string,
	expected: 'sent' | 'failed' | 'unknown',
): Promise<void> {
	await expect
		.poll(
			async () => {
				const response = await request.get('/api/v1/settings/notification-deliveries?limit=100&offset=0');
				expect(response.ok()).toBe(true);
				const delivery = readNotificationDeliveries(await response.json()).items.find((item) => item.id === id);
				expect(delivery, 'The accepted delivery must remain observable').toBeDefined();
				return delivery?.status;
			},
			{ timeout: 30000 },
		)
		.toBe(expected);
}

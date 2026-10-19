import { uuid } from '@nexus-terminal/shared/common/http-codec';
import {
	readAuditQuery,
	readNotificationCreate,
	readNotificationUpdate,
	readNotificationVersion,
	readNotificationResponse,
	readNotificationList,
	readNotificationTestResponse,
	readNotificationDeliveries,
	readNotificationDeleteResponse,
	readNotificationUnsavedTest,
} from '@nexus-terminal/shared/operations/http-codec';
import type { NotificationCreateRequest } from '@nexus-terminal/shared/operations/notifications/http';
import type { NotificationSettingView } from '@nexus-terminal/shared/operations/notifications/model';
import { requestOperation, OperationsRequestFailure } from '@/client/operations/operations-request';
import {
	fromNotification,
	fromDelivery,
	toNotificationChange,
	toNotificationConfig,
} from '../model/notification-mapper';
import type {
	NotificationSetting,
	NotificationChange,
	NotificationDelivery,
	NotificationConfigChange,
	NotificationDeliveryPage,
} from '../model/notification-types';

function validTimes(value: { createdAt: number; updatedAt: number }): boolean {
	return Number.isFinite(new Date(value.createdAt).getTime()) && Number.isFinite(new Date(value.updatedAt).getTime());
}

function settingPath(id: string): string {
	try {
		return '/settings/notifications/' + uuid(id);
	} catch (cause) {
		throw new OperationsRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
}

function verifyChange(
	value: NotificationSettingView,
	input: NotificationCreateRequest,
	id: string | null,
	version: number,
): void {
	const config = value.config;
	const change = input.config;
	const common =
		value.name === input.name &&
		value.enabled === input.enabled &&
		value.events.length === input.events.length &&
		value.events.every((event) => input.events.includes(event)) &&
		config.bodyTemplate === change.bodyTemplate;
	let matches = false;
	if (config.kind === 'webhook' && change.kind === 'webhook') {
		matches =
			config.url === change.url &&
			config.method === change.method &&
			config.headers.length === change.headers.length &&
			change.headers.every((header) => {
				const observed = config.headers.find((item) => item.name.toLowerCase() === header.name.toLowerCase());
				return (
					observed !== undefined &&
					(header.value.action === 'keep' ||
						observed.hasValue === (header.value.action === 'replace' && header.value.value !== ''))
				);
			});
	} else if (config.kind === 'email' && change.kind === 'email') {
		matches =
			config.to === change.to &&
			config.from === change.from &&
			config.host === change.host &&
			config.port === change.port &&
			config.secure === change.secure &&
			config.username === change.username &&
			(change.password.action === 'keep' ||
				config.hasPassword === (change.password.action === 'replace' && change.password.value !== ''));
	} else if (config.kind === 'telegram' && change.kind === 'telegram') {
		matches =
			config.origin === change.origin &&
			config.chatId === change.chatId &&
			(change.botToken.action === 'keep' ||
				config.hasBotToken === (change.botToken.action === 'replace' && change.botToken.value !== ''));
	}
	if (
		!validTimes(value) ||
		!common ||
		!matches ||
		(id !== null && value.id !== id) ||
		value.version !== version + 1
	) {
		throw new OperationsRequestFailure('protocol_failure', 'unknown');
	}
}

export const notificationsApi = {
	async list(signal?: AbortSignal): Promise<NotificationSetting[]> {
		const page = await requestOperation({
			path: '/settings/notifications',
			method: 'GET',
			decode: readNotificationList,
			signal,
		});
		if (page.items.some((item) => !validTimes(item))) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		}
		return page.items.map(fromNotification);
	},

	async create(change: NotificationChange, signal?: AbortSignal): Promise<NotificationSetting> {
		const input = toNotificationChange(change);
		const value = await requestOperation({
			path: '/settings/notifications',
			method: 'POST',

			input: () => readNotificationCreate(input),

			decode: readNotificationResponse,
			signal,
		});
		verifyChange(value.setting, input, null, 0);
		return fromNotification(value.setting);
	},

	async update(
		id: string,
		expectedVersion: number,
		change: NotificationChange,
		signal?: AbortSignal,
	): Promise<NotificationSetting> {
		const path = settingPath(id);
		const input = toNotificationChange(change);
		const value = await requestOperation({
			path,
			method: 'PUT',

			input: () =>
				readNotificationUpdate({
					expectedVersion,
					name: input.name,
					enabled: input.enabled,
					events: input.events,
					config: input.config,
				}),

			decode: readNotificationResponse,
			signal,
		});
		verifyChange(value.setting, input, id, expectedVersion);
		return fromNotification(value.setting);
	},

	async remove(id: string, expectedVersion: number, signal?: AbortSignal): Promise<void> {
		await requestOperation({
			path: settingPath(id),
			method: 'DELETE',

			input: () => readNotificationVersion({ expectedVersion }),

			decode: readNotificationDeleteResponse,
			signal,
		});
	},

	async testSaved(id: string, signal?: AbortSignal): Promise<NotificationDelivery> {
		const value = await requestOperation({
			path: settingPath(id) + '/test',
			method: 'POST',

			input: () => ({}),

			decode: readNotificationTestResponse,
			signal,
		});
		if (
			value.delivery.settingId !== id ||
			value.delivery.event !== 'SETTINGS_UPDATED' ||
			value.delivery.status !== 'queued' ||
			!validTimes(value.delivery)
		) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		}
		return fromDelivery(value.delivery);
	},

	async testUnsaved(config: NotificationConfigChange, signal?: AbortSignal): Promise<NotificationDelivery> {
		const value = await requestOperation({
			path: '/settings/notifications/test-unsaved',
			method: 'POST',

			input: () => readNotificationUnsavedTest({ config: toNotificationConfig(config) }),

			decode: readNotificationTestResponse,
			signal,
		});
		if (
			value.delivery.settingId !== null ||
			value.delivery.event !== 'SETTINGS_UPDATED' ||
			value.delivery.status !== 'queued' ||
			!validTimes(value.delivery)
		) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		}
		return fromDelivery(value.delivery);
	},

	async deliveries(offset = 0, limit = 40, signal?: AbortSignal): Promise<NotificationDeliveryPage> {
		let query;
		try {
			query = readAuditQuery(new URLSearchParams({ offset: String(offset), limit: String(limit) }));
		} catch (cause) {
			throw new OperationsRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const value = await requestOperation({
			path: '/settings/notification-deliveries?offset=' + query.offset + '&limit=' + query.limit,
			method: 'GET',
			decode: readNotificationDeliveries,
			signal,
		});
		if (
			value.items.some((item) => !validTimes(item)) ||
			value.items.length > limit ||
			(value.nextOffset !== null &&
				(value.items.length !== limit || value.nextOffset !== offset + value.items.length))
		) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		}
		return { items: value.items.map(fromDelivery), nextOffset: value.nextOffset };
	},
};

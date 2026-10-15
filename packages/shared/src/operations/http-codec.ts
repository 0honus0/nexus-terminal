import { record, integer, text, uuid, InvalidPayload } from '../common/http-codec.js';
import {
	OPERATION_EVENTS,
	OPERATIONS_BODY_MAX_BYTES,
	OPERATIONS_RESPONSE_MAX_BYTES,
	OPERATIONS_ERROR_CODES,
} from './values.js';
import { BACKEND_LOG_LEVELS } from './logging/values.js';
import type { BackendLoggingUpdate } from './logging/http.js';
import type { BackendLoggingView } from './logging/model.js';
import type { AuditQuery, AuditResponse } from './audit/http.js';
import type { AuditView } from './audit/model.js';
import type {
	NotificationSecretUpdate,
	NotificationConfigInput,
	NotificationCreateRequest,
	NotificationUpdateRequest,
	NotificationVersionRequest,
} from './notifications/http.js';
import type {
	NotificationSettingView,
	NotificationConfigView,
	NotificationDeliveryView,
} from './notifications/model.js';
import {
	NOTIFICATION_DELIVERY_STATUSES,
	NOTIFICATION_MAX_SETTINGS,
	NOTIFICATION_MAX_TEXT_BYTES,
} from './notifications/values.js';

export { InvalidPayload as InvalidOperationsPayload };

export function operationsBoolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new InvalidPayload();
	}
	return value;
}

function nullableText(value: unknown, max: number): string | null {
	return value === null ? null : text(value, max);
}

function secret(value: unknown): NotificationSecretUpdate {
	const r = record(
		value,
		value !== null && typeof value === 'object' && 'action' in value && value.action === 'replace'
			? ['action', 'value']
			: ['action'],
	);
	if (r.action === 'keep' || r.action === 'clear') {
		return { action: r.action };
	}
	if (r.action === 'replace') {
		return { action: 'replace', value: text(r.value, 4096) };
	}
	throw new InvalidPayload();
}

function events(value: unknown): NotificationCreateRequest['events'] {
	if (!Array.isArray(value) || value.length > OPERATION_EVENTS.length) {
		throw new InvalidPayload();
	}
	const items = value.map((raw: unknown) => {
		const event = OPERATION_EVENTS.find((v) => v === raw);
		if (!event) {
			throw new InvalidPayload();
		}
		return event;
	});
	if (new Set(items).size !== items.length) {
		throw new InvalidPayload();
	}
	return items;
}

export function readNotificationConfig(value: unknown): NotificationConfigInput {
	if (value === null || typeof value !== 'object' || !('kind' in value)) {
		throw new InvalidPayload();
	}
	if (value.kind === 'webhook') {
		const r = record(value, ['kind', 'url', 'method', 'headers', 'bodyTemplate']);
		if (
			(r.method !== 'GET' && r.method !== 'POST' && r.method !== 'PUT') ||
			!Array.isArray(r.headers) ||
			r.headers.length > 32
		) {
			throw new InvalidPayload();
		}
		const headers = r.headers.map((raw: unknown) => {
			const h = record(raw, ['name', 'value']);
			const name = text(h.name, 128);
			if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
				throw new InvalidPayload();
			}
			return { name, value: secret(h.value) };
		});
		if (new Set(headers.map((h) => h.name.toLowerCase())).size !== headers.length) {
			throw new InvalidPayload();
		}
		return {
			kind: 'webhook',
			url: text(r.url, 4096),
			method: r.method,
			headers,
			bodyTemplate: nullableText(r.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	}
	if (value.kind === 'email') {
		const r = record(value, [
			'kind',
			'to',
			'from',
			'host',
			'port',
			'secure',
			'username',
			'password',
			'bodyTemplate',
		]);
		return {
			kind: 'email',
			to: text(r.to, 320),
			from: text(r.from, 320),
			host: text(r.host, 256),
			port: integer(r.port, 1, 65535),
			secure: operationsBoolean(r.secure),
			username: r.username === '' ? '' : text(r.username, 256),
			password: secret(r.password),
			bodyTemplate: nullableText(r.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	}
	if (value.kind === 'telegram') {
		const r = record(value, ['kind', 'origin', 'chatId', 'botToken', 'bodyTemplate']);
		return {
			kind: 'telegram',
			origin: text(r.origin, 4096),
			chatId: text(r.chatId, 128),
			botToken: secret(r.botToken),
			bodyTemplate: nullableText(r.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	}
	throw new InvalidPayload();
}

export function readNotificationCreate(value: unknown): NotificationCreateRequest {
	const r = record(value, ['name', 'enabled', 'events', 'config'], OPERATIONS_BODY_MAX_BYTES);
	return {
		name: text(r.name, 128),
		enabled: operationsBoolean(r.enabled),
		events: events(r.events),
		config: readNotificationConfig(r.config),
	};
}

export function readNotificationUpdate(value: unknown): NotificationUpdateRequest {
	const r = record(value, ['expectedVersion', 'name', 'enabled', 'events', 'config'], OPERATIONS_BODY_MAX_BYTES);
	return {
		expectedVersion: integer(r.expectedVersion, 1),
		name: text(r.name, 128),
		enabled: operationsBoolean(r.enabled),
		events: events(r.events),
		config: readNotificationConfig(r.config),
	};
}

export function readNotificationVersion(value: unknown): NotificationVersionRequest {
	return { expectedVersion: integer(record(value, ['expectedVersion']).expectedVersion, 1) };
}

export function readBackendLoggingUpdate(value: unknown): BackendLoggingUpdate {
	const r = record(value, ['expectedVersion', 'level']);
	const level = BACKEND_LOG_LEVELS.find((v) => v === r.level);
	if (!level) {
		throw new InvalidPayload();
	}
	return { expectedVersion: integer(r.expectedVersion), level };
}

export function readBackendLoggingView(value: unknown): BackendLoggingView {
	const r = record(value, ['version', 'level', 'effectiveLevel', 'updatedAt']);
	const level = BACKEND_LOG_LEVELS.find((v) => v === r.level);
	const effectiveLevel = BACKEND_LOG_LEVELS.find((v) => v === r.effectiveLevel);
	if (!level || !effectiveLevel) {
		throw new InvalidPayload();
	}
	return { version: integer(r.version), level, effectiveLevel, updatedAt: integer(r.updatedAt) };
}

export function readAuditQuery(query: URLSearchParams): AuditQuery {
	const keys = ['event', 'from', 'to', 'q', 'limit', 'offset'];
	if ([...query.keys()].some((k) => !keys.includes(k)) || keys.some((k) => query.getAll(k).length > 1)) {
		throw new InvalidPayload();
	}

	function number(key: string, fallback: number | null, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
		const raw = query.get(key);
		if (raw === null) {
			return fallback;
		}
		if (!/^(0|[1-9][0-9]{0,15})$/u.test(raw)) {
			throw new InvalidPayload();
		}
		return integer(Number(raw), min, max);
	}

	const e = query.get('event');
	const event = e === null ? null : OPERATION_EVENTS.find((v) => v === e);
	if (event === undefined) {
		throw new InvalidPayload();
	}
	const limit = number('limit', 50, 1, 200);
	const offset = number('offset', 0, 0, 1000000);
	if (limit === null || offset === null) {
		throw new InvalidPayload();
	}
	const from = number('from', null, 0);
	const to = number('to', null, 0);
	if (from !== null && to !== null && from > to) {
		throw new InvalidPayload();
	}
	const q = query.get('q') ?? '';
	return { event, from, to, q: q === '' ? '' : text(q, 256), limit, offset };
}

export function readAuditResponse(value: unknown): AuditResponse {
	const r = record(value, ['items', 'nextOffset'], OPERATIONS_RESPONSE_MAX_BYTES);
	if (!Array.isArray(r.items) || r.items.length > 200) {
		throw new InvalidPayload();
	}
	const items = r.items.map((raw: unknown): AuditView => {
		const row = record(raw, ['id', 'event', 'createdAt', 'userId', 'sourceIp', 'subjectId', 'route', 'statusCode']);
		const event = OPERATION_EVENTS.find((v) => v === row.event);
		if (!event) {
			throw new InvalidPayload();
		}
		return {
			id: integer(row.id, 1),
			event,
			createdAt: integer(row.createdAt),
			userId: row.userId === null ? null : integer(row.userId, 1),
			sourceIp: nullableText(row.sourceIp, 128),
			subjectId: nullableText(row.subjectId, 256),
			route: nullableText(row.route, 512),
			statusCode: row.statusCode === null ? null : integer(row.statusCode, 100, 599),
		};
	});
	if (new Set(items.map((item) => item.id)).size !== items.length) {
		throw new InvalidPayload();
	}
	return { items, nextOffset: r.nextOffset === null ? null : integer(r.nextOffset, 1, 1000000) };
}

export function readNotificationDelivery(value: unknown): NotificationDeliveryView {
	const r = record(value, ['id', 'settingId', 'event', 'status', 'createdAt', 'updatedAt']);
	const event = OPERATION_EVENTS.find((v) => v === r.event);
	const status = NOTIFICATION_DELIVERY_STATUSES.find((v) => v === r.status);
	if (!event || !status) {
		throw new InvalidPayload();
	}
	const createdAt = integer(r.createdAt);
	return {
		id: uuid(r.id),
		settingId: r.settingId === null ? null : uuid(r.settingId),
		event,
		status,
		createdAt,
		updatedAt: integer(r.updatedAt, createdAt),
	};
}

export function readOperationsError(value: unknown): { code: (typeof OPERATIONS_ERROR_CODES)[number] } {
	const r = record(value, ['code']);
	const code = OPERATIONS_ERROR_CODES.find((v) => v === r.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}

export function readNotificationView(value: unknown): NotificationSettingView {
	const r = record(
		value,
		['id', 'version', 'name', 'enabled', 'events', 'config', 'createdAt', 'updatedAt'],
		OPERATIONS_RESPONSE_MAX_BYTES,
	);
	const cfg = r.config;
	if (cfg === null || typeof cfg !== 'object' || !('kind' in cfg)) {
		throw new InvalidPayload();
	}
	let config: NotificationConfigView;
	if (cfg.kind === 'webhook') {
		const c = record(cfg, ['kind', 'url', 'method', 'headers', 'bodyTemplate'], OPERATIONS_RESPONSE_MAX_BYTES);
		if (
			(c.method !== 'GET' && c.method !== 'POST' && c.method !== 'PUT') ||
			!Array.isArray(c.headers) ||
			c.headers.length > 32
		) {
			throw new InvalidPayload();
		}
		const headers = c.headers.map((value: unknown) => {
			const h = record(value, ['name', 'hasValue']);
			return { name: text(h.name, 128), hasValue: operationsBoolean(h.hasValue) };
		});
		if (new Set(headers.map((h) => h.name.toLowerCase())).size !== headers.length) {
			throw new InvalidPayload();
		}
		config = {
			kind: 'webhook',
			url: text(c.url, 4096),
			method: c.method,
			headers,
			bodyTemplate: nullableText(c.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	} else if (cfg.kind === 'email') {
		const c = record(
			cfg,
			['kind', 'to', 'from', 'host', 'port', 'secure', 'username', 'hasPassword', 'bodyTemplate'],
			OPERATIONS_RESPONSE_MAX_BYTES,
		);
		config = {
			kind: 'email',
			to: text(c.to, 320),
			from: text(c.from, 320),
			host: text(c.host, 256),
			port: integer(c.port, 1, 65535),
			secure: operationsBoolean(c.secure),
			username: c.username === '' ? '' : text(c.username, 256),
			hasPassword: operationsBoolean(c.hasPassword),
			bodyTemplate: nullableText(c.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	} else if (cfg.kind === 'telegram') {
		const c = record(
			cfg,
			['kind', 'origin', 'chatId', 'hasBotToken', 'bodyTemplate'],
			OPERATIONS_RESPONSE_MAX_BYTES,
		);
		config = {
			kind: 'telegram',
			origin: text(c.origin, 4096),
			chatId: text(c.chatId, 128),
			hasBotToken: operationsBoolean(c.hasBotToken),
			bodyTemplate: nullableText(c.bodyTemplate, NOTIFICATION_MAX_TEXT_BYTES),
		};
	} else {
		throw new InvalidPayload();
	}
	const createdAt = integer(r.createdAt);
	return {
		id: uuid(r.id),
		version: integer(r.version, 1),
		name: text(r.name, 128),
		enabled: operationsBoolean(r.enabled),
		events: events(r.events),
		config,
		createdAt,
		updatedAt: integer(r.updatedAt, createdAt),
	};
}

export function readNotificationResponse(
	value: unknown,
): import('./notifications/http.js').NotificationSettingResponse {
	return { setting: readNotificationView(record(value, ['setting'], OPERATIONS_RESPONSE_MAX_BYTES).setting) };
}

export function readNotificationList(value: unknown): import('./notifications/http.js').NotificationListResponse {
	const r = record(value, ['items'], OPERATIONS_RESPONSE_MAX_BYTES);
	if (!Array.isArray(r.items) || r.items.length > NOTIFICATION_MAX_SETTINGS) {
		throw new InvalidPayload();
	}
	const items = r.items.map((v: unknown) => readNotificationView(v));
	if (new Set(items.map((v) => v.id)).size !== items.length) {
		throw new InvalidPayload();
	}
	return { items };
}

export function readNotificationTestResponse(
	value: unknown,
): import('./notifications/http.js').NotificationTestResponse {
	return { delivery: readNotificationDelivery(record(value, ['delivery']).delivery) };
}

export function readNotificationDeliveries(
	value: unknown,
): import('./notifications/http.js').NotificationDeliveriesResponse {
	const r = record(value, ['items', 'nextOffset'], OPERATIONS_RESPONSE_MAX_BYTES);
	if (!Array.isArray(r.items) || r.items.length > 200) {
		throw new InvalidPayload();
	}
	const items = r.items.map((v: unknown) => readNotificationDelivery(v));
	if (new Set(items.map((v) => v.id)).size !== items.length) {
		throw new InvalidPayload();
	}
	return { items, nextOffset: r.nextOffset === null ? null : integer(r.nextOffset, 1, 1000000) };
}

export function readNotificationDeleteResponse(value: unknown): { deleted: true } {
	if (record(value, ['deleted']).deleted !== true) {
		throw new InvalidPayload();
	}
	return { deleted: true };
}

export function readNotificationUnsavedTest(
	value: unknown,
): import('./notifications/http.js').NotificationUnsavedTestRequest {
	return { config: readNotificationConfig(record(value, ['config'], OPERATIONS_BODY_MAX_BYTES).config) };
}

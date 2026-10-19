import { OPERATION_EVENTS } from '@nexus-terminal/shared/operations/values';
import { NOTIFICATION_DELIVERY_STATUSES } from '@nexus-terminal/shared/operations/notifications/values';
import type {
	StoredNotificationConfig,
	StoredNotificationSetting,
	StoredNotificationDelivery,
} from '../../storage/notification-storage.js';

// Encryption expands the bounded request; this is a storage-document limit, not a wire budget.
const CONFIG_MAX_BYTES = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== keys.length ||
		Object.keys(value).some((key) => !keys.includes(key))
	) {
		throw new Error('Corrupt notification object');
	}
	return value;
}

function readInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt notification integer');
	}
	return value;
}

function readText(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt notification text');
	}
	return value;
}

function readIdentifier(value: unknown): string {
	const id = readText(value, 36);
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
		throw new Error('Corrupt notification identifier');
	}
	return id;
}

function nullable(value: unknown, max: number): string | null {
	return value === null ? null : readText(value, max);
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new Error('Corrupt notification flag');
	}
	return value;
}

export function storedConfig(value: unknown): StoredNotificationConfig {
	if (value === null || typeof value !== 'object' || !('kind' in value)) {
		throw new Error('Corrupt notification config');
	}
	if (value.kind === 'webhook') {
		const r = readRecord(value, ['kind', 'url', 'method', 'headers', 'bodyTemplate']);
		if (
			(r.method !== 'GET' && r.method !== 'POST' && r.method !== 'PUT') ||
			!Array.isArray(r.headers) ||
			r.headers.length > 32
		) {
			throw new Error('Corrupt webhook');
		}
		return {
			kind: 'webhook',
			url: readText(r.url, 4096),
			method: r.method,
			headers: r.headers.map((v: unknown) => {
				const h = readRecord(v, ['name', 'value']);
				return { name: readText(h.name, 128), value: nullable(h.value, 16384) };
			}),
			bodyTemplate: nullable(r.bodyTemplate, 16384),
		};
	}
	if (value.kind === 'email') {
		const r = readRecord(value, [
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
			to: readText(r.to, 320),
			from: readText(r.from, 320),
			host: readText(r.host, 256),
			port: readInteger(r.port, 1, 65535),
			secure: boolean(r.secure),
			username: r.username === '' ? '' : readText(r.username, 256),
			password: nullable(r.password, 16384),
			bodyTemplate: nullable(r.bodyTemplate, 16384),
		};
	}
	if (value.kind === 'telegram') {
		const r = readRecord(value, ['kind', 'origin', 'chatId', 'botToken', 'bodyTemplate']);
		return {
			kind: 'telegram',
			origin: readText(r.origin, 4096),
			chatId: readText(r.chatId, 128),
			botToken: nullable(r.botToken, 16384),
			bodyTemplate: nullable(r.bodyTemplate, 16384),
		};
	}
	throw new Error('Corrupt notification kind');
}

export function readStoredConfig(value: unknown): StoredNotificationConfig {
	const decoded: unknown = JSON.parse(readText(value, CONFIG_MAX_BYTES));
	return storedConfig(decoded);
}

export function setting(row: Record<string, unknown>): StoredNotificationSetting {
	const raw: unknown = JSON.parse(readText(row.events_json, 32768));
	if (!Array.isArray(raw)) {
		throw new Error('Corrupt notification events');
	}
	const events = raw.map((v: unknown) => {
		const e = OPERATION_EVENTS.find((e) => e === v);
		if (!e) {
			throw new Error('Corrupt notification event');
		}
		return e;
	});
	if (new Set(events).size !== events.length || (row.enabled !== 0 && row.enabled !== 1)) {
		throw new Error('Corrupt notification flags');
	}
	const createdAt = readInteger(row.created_at);
	return {
		id: readIdentifier(row.id),
		version: readInteger(row.version, 1),
		name: readText(row.name, 128),
		enabled: row.enabled === 1,
		events,
		config: readStoredConfig(row.config_json),
		createdAt,
		updatedAt: readInteger(row.updated_at, createdAt),
	};
}

export function delivery(row: Record<string, unknown>): StoredNotificationDelivery {
	const event = OPERATION_EVENTS.find((e) => e === row.event);
	const status = NOTIFICATION_DELIVERY_STATUSES.find((s) => s === row.status);
	if (!event || !status) {
		throw new Error('Corrupt notification delivery');
	}
	const createdAt = readInteger(row.created_at);
	return {
		id: readIdentifier(row.id),
		settingId: row.setting_id === null ? null : readIdentifier(row.setting_id),
		event,
		status,
		createdAt,
		updatedAt: readInteger(row.updated_at, createdAt),
	};
}

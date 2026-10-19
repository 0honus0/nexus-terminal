import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { SecretBox } from '../../../../../platform/security/secret-box.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import {
	transferSnapshotRow,
	protectSnapshotSecret,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import { readStoredConfig } from './notification-row.js';

/** Persistent JSON and field encryption scopes remain with the notification storage owner. */
function transformNotificationSnapshot(
	row: SqlRow,
	columns: readonly string[],
	isDelivery: boolean,
	secrets: SecretBox | null,
	direction: 'export' | 'import',
): SqlRow {
	const result = transferSnapshotRow(row, columns, new Map(), secrets);
	const id = isDelivery ? (row.setting_id ?? row.id) : row.id;
	if (typeof id !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	const value = readStoredConfig(row.config_json);

	const secret = (field: string, value: string | null): string | null => {
		if (value === null) {
			return null;
		}
		if (!secrets) {
			throw new SnapshotFailure('unavailable');
		}
		const scope = 'notification:' + id + ':' + field;
		return direction === 'export' ? secrets.decrypt(value, scope) : protectSnapshotSecret(value, scope, secrets);
	};

	if (value.kind === 'webhook') {
		result.config_json = JSON.stringify({
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((header) => ({
				name: header.name,
				value: secret('header:' + header.name.toLowerCase(), header.value),
			})),
			bodyTemplate: value.bodyTemplate,
		});
	} else if (value.kind === 'email') {
		result.config_json = JSON.stringify({
			kind: 'email',
			to: value.to,
			from: value.from,
			host: value.host,
			port: value.port,
			secure: value.secure,
			username: value.username,
			password: secret('password', value.password),
			bodyTemplate: value.bodyTemplate,
		});
	} else {
		result.config_json = JSON.stringify({
			kind: 'telegram',
			origin: value.origin,
			chatId: value.chatId,
			botToken: secret('botToken', value.botToken),
			bodyTemplate: value.bodyTemplate,
		});
	}
	return result;
}

export function transferNotificationSnapshot(
	row: SqlRow,
	columns: readonly string[],
	isDelivery: boolean,
	secrets: SecretBox | null,
): SqlRow {
	return transformNotificationSnapshot(row, columns, isDelivery, secrets, 'export');
}

export function restoreNotificationSnapshot(
	row: SqlRow,
	columns: readonly string[],
	isDelivery: boolean,
	secrets: SecretBox | null,
): SqlRow {
	return transformNotificationSnapshot(row, columns, isDelivery, secrets, 'import');
}

import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { AGENT_PLUGIN_STAGE_STATUSES } from '@nexus-terminal/shared/agent/plugins/values';
import type { StoredPluginPublisher, StoredPluginStage } from '../../storage/plugin-storage.js';
import { pluginManifest } from '../package/plugin-manifest.js';

function text(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new Error('Corrupt plugin text');
	}
	return value;
}

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt plugin number');
	}
	return value;
}

export function publisherRow(row: SqlRow): StoredPluginPublisher {
	return {
		keyId: text(row.key_id),
		publicKeyPem: text(row.public_key_pem),
		label: text(row.label),
		version: integer(row.version, 1),
		createdAt: integer(row.created_at),
		revokedAt: row.revoked_at === null ? null : integer(row.revoked_at),
	};
}

export function stageRow(row: SqlRow): StoredPluginStage {
	const status = AGENT_PLUGIN_STAGE_STATUSES.find((item) => item === row.status);
	if (!status) {
		throw new Error('Corrupt plugin stage status');
	}
	const packageHash = text(row.package_hash);
	if (!/^[a-f0-9]{64}$/u.test(packageHash)) {
		throw new Error('Corrupt package hash');
	}
	let manifest = null;
	if (row.manifest_json !== null) {
		const value: unknown = JSON.parse(text(row.manifest_json));
		manifest = pluginManifest(value);
	}
	return {
		id: text(row.id),
		packageHash,
		sizeBytes: integer(row.size_bytes, 1),
		status,
		version: integer(row.version, 1),
		publisherKeyId: row.publisher_key_id === null ? null : text(row.publisher_key_id),
		manifest,
		createdAt: integer(row.created_at),
		updatedAt: integer(row.updated_at),
	};
}

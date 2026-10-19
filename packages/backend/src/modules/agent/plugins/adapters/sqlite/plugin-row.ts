import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import {
	AGENT_PLUGIN_STAGE_STATUSES,
	AGENT_PLUGIN_MAX_ARCHIVE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
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
	const keyId = text(row.key_id),
		publicKeyPem = text(row.public_key_pem),
		label = text(row.label);
	const createdAt = integer(row.created_at),
		revokedAt = row.revoked_at === null ? null : integer(row.revoked_at, createdAt);
	if (
		!/^ed25519:[a-f0-9]{64}$/u.test(keyId) ||
		Buffer.byteLength(publicKeyPem) > 8192 ||
		Buffer.byteLength(label) > 256
	) {
		throw new Error('Corrupt plugin publisher');
	}
	return {
		keyId,
		publicKeyPem,
		label,
		version: integer(row.version, 1),
		createdAt,
		revokedAt,
	};
}

export function stageRow(row: SqlRow): StoredPluginStage {
	const status = AGENT_PLUGIN_STAGE_STATUSES.find((item) => item === row.status);
	if (!status) {
		throw new Error('Corrupt plugin stage status');
	}
	const packageHash = text(row.package_hash);
	const id = text(row.id),
		sizeBytes = integer(row.size_bytes, 1),
		createdAt = integer(row.created_at);
	const publisherKeyId = row.publisher_key_id === null ? null : text(row.publisher_key_id);
	if (
		!/^[a-f0-9]{64}$/u.test(packageHash) ||
		!AGENT_ID_PATTERN.test(id) ||
		sizeBytes > AGENT_PLUGIN_MAX_ARCHIVE_BYTES ||
		(publisherKeyId !== null && !/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId))
	) {
		throw new Error('Corrupt package hash');
	}
	let manifest = null;
	if (row.manifest_json !== null) {
		const encoded = text(row.manifest_json);
		if (Buffer.byteLength(encoded) > 65536) {
			throw new Error('Corrupt plugin manifest size');
		}
		const value: unknown = JSON.parse(encoded);
		manifest = pluginManifest(value);
	}
	const verified = status === 'verified' || status === 'installed';
	if (
		verified !== (manifest !== null && publisherKeyId !== null) ||
		(manifest === null) !== (publisherKeyId === null)
	) {
		throw new Error('Corrupt plugin stage verification');
	}
	return {
		id,
		packageHash,
		sizeBytes,
		status,
		version: integer(row.version, 1),
		publisherKeyId,
		manifest,
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}

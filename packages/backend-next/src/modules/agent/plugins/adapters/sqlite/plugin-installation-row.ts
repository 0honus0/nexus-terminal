import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredPluginInstallation } from '../../storage/plugin-storage.js';

function text(input: unknown): string {
	if (typeof input !== 'string' || !input) {
		throw new Error('Corrupt plugin installation text');
	}
	return input;
}

function integer(input: unknown): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
		throw new Error('Corrupt plugin installation integer');
	}
	return input;
}

export function pluginInstallationRow(row: SqlRow): StoredPluginInstallation {
	if (row.status !== 'installed' && row.status !== 'draining' && row.status !== 'removed') {
		throw new Error('Corrupt installation status');
	}
	const packageHash = text(row.package_hash),
		publisherKeyId = text(row.publisher_key_id),
		revision = integer(row.revision),
		createdAt = integer(row.created_at),
		updatedAt = integer(row.updated_at);
	if (
		!/^[a-f0-9]{64}$/u.test(packageHash) ||
		!/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId) ||
		revision < 1 ||
		updatedAt < createdAt
	) {
		throw new Error('Corrupt plugin installation facts');
	}
	return {
		appId: text(row.app_id),
		definitionId: text(row.definition_id),
		version: text(row.version),
		packageHash,
		publisherKeyId,
		status: row.status,
		revision,
		createdAt,
		updatedAt,
	};
}

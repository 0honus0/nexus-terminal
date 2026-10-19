import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredPluginInstallation } from '../../storage/plugin-storage.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_PLUGIN_VERSION_PATTERN,
	AGENT_PLUGIN_INSTALLATION_STATUSES,
} from '@nexus-terminal/shared/agent/plugins/values';

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
	const status = AGENT_PLUGIN_INSTALLATION_STATUSES.find((value) => value === row.status);
	if (!status) {
		throw new Error('Corrupt installation status');
	}
	const packageHash = text(row.package_hash),
		publisherKeyId = text(row.publisher_key_id),
		revision = integer(row.revision),
		createdAt = integer(row.created_at),
		updatedAt = integer(row.updated_at);
	const appId = text(row.app_id),
		definitionId = text(row.definition_id),
		version = text(row.version);
	if (
		!AGENT_ID_PATTERN.test(appId) ||
		Buffer.byteLength(definitionId) > 128 ||
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(definitionId) ||
		Buffer.byteLength(version) > 64 ||
		!AGENT_PLUGIN_VERSION_PATTERN.test(version) ||
		!/^[a-f0-9]{64}$/u.test(packageHash) ||
		!/^ed25519:[a-f0-9]{64}$/u.test(publisherKeyId) ||
		revision < 1 ||
		updatedAt < createdAt
	) {
		throw new Error('Corrupt plugin installation facts');
	}
	return {
		appId,
		definitionId,
		version,
		packageHash,
		publisherKeyId,
		status,
		revision,
		createdAt,
		updatedAt,
	};
}

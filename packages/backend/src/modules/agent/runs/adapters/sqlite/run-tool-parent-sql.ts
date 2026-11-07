import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredToolChildRelation } from '../../storage/run-tool-storage.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_APPROVAL_OPERATION_HASH_PATTERN } from '@nexus-terminal/shared/agent/governance/values';
import { AGENT_APP_MAX_DEFINITION_ID_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { TOOL_PROVIDER_CALL_ID_MAX_BYTES } from '../../run-tool-limits.js';

/** Historical relations use the same strict representation without requiring current execution authority. */
export function readToolChild(row: SqlRow): StoredToolChildRelation {
	if (
		typeof row.tool_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.tool_id) ||
		typeof row.parent_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.parent_id) ||
		row.tool_id === row.parent_id ||
		typeof row.parent_hash !== 'string' ||
		!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(row.parent_hash) ||
		typeof row.request_key !== 'string' ||
		!row.request_key.trim() ||
		Buffer.byteLength(row.request_key, 'utf8') > TOOL_PROVIDER_CALL_ID_MAX_BYTES
	) {
		throw new Error('Corrupt tool parent relation');
	}
	if (
		row.kind === 'acp_permission' &&
		row.package_id === null &&
		row.installation_revision === null &&
		row.instance_id === null &&
		row.instance_revision === null
	) {
		return {
			toolId: row.tool_id,
			parentId: row.parent_id,
			parentHash: row.parent_hash,
			requestKey: row.request_key,
			kind: 'acp_permission',
			plugin: null,
		};
	}
	if (
		row.kind !== 'plugin_tool' ||
		typeof row.package_id !== 'string' ||
		Buffer.byteLength(row.package_id, 'utf8') > AGENT_APP_MAX_DEFINITION_ID_BYTES ||
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(row.package_id) ||
		typeof row.instance_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.instance_id) ||
		typeof row.installation_revision !== 'number' ||
		!Number.isSafeInteger(row.installation_revision) ||
		row.installation_revision < 1 ||
		typeof row.instance_revision !== 'number' ||
		!Number.isSafeInteger(row.instance_revision) ||
		row.instance_revision < 1
	) {
		throw new Error('Corrupt plugin tool identity');
	}
	return {
		toolId: row.tool_id,
		parentId: row.parent_id,
		parentHash: row.parent_hash,
		requestKey: row.request_key,
		kind: 'plugin_tool',
		plugin: {
			packageId: row.package_id,
			installationRevision: row.installation_revision,
			instanceId: row.instance_id,
			instanceRevision: row.instance_revision,
		},
	};
}

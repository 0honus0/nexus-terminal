import { agentRecord, InvalidAgentPayload } from '../http-codec.js';
import { readAgentPluginPackageId } from '../plugins/http-codec.js';
import { AGENT_PLUGIN_MAX_VERSION_BYTES, AGENT_PLUGIN_PACKAGE_HASH_LENGTH } from '../plugins/package-values.js';
import { isAgentPluginVersion } from '../plugins/values.js';
import { pluginContractText } from '../plugins/registry-codec.js';
import type { AgentToolIdentity } from './identity.js';

export function readAgentToolIdentity(input: unknown): AgentToolIdentity {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'plugin'
			? ['kind', 'packageId', 'packageVersion', 'packageSha256', 'name']
			: ['kind', 'operation'],
	);
	if (row.kind === 'plugin') {
		if (
			typeof row.packageVersion !== 'string' ||
			new TextEncoder().encode(row.packageVersion).byteLength > AGENT_PLUGIN_MAX_VERSION_BYTES ||
			!isAgentPluginVersion(row.packageVersion) ||
			typeof row.packageSha256 !== 'string' ||
			row.packageSha256.length !== AGENT_PLUGIN_PACKAGE_HASH_LENGTH ||
			!/^[a-f0-9]+$/u.test(row.packageSha256) ||
			typeof row.name !== 'string'
		) {
			throw new InvalidAgentPayload();
		}
		return {
			kind: 'plugin',
			packageId: readAgentPluginPackageId(row.packageId),
			packageVersion: row.packageVersion,
			packageSha256: row.packageSha256,
			name: pluginContractText(row.name),
		};
	}
	if (row.kind !== 'host') {
		throw new InvalidAgentPayload();
	}
	return { kind: 'host', operation: pluginContractText(row.operation) };
}

import { agentRecord, agentInteger, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_APPROVAL_RISKS, AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import { readAgentPluginPackageReference } from '@nexus-terminal/shared/agent/plugins/http-codec';
import { readAgentPluginBinding, pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredOperation } from '../../storage/operation-storage.js';
import type { StoredOperationActivity } from '../../storage/operation-activity-storage.js';

export function operationPresentation(
	operation: StoredOperation,
): Omit<StoredOperationActivity, 'operation' | 'effects' | 'outputArtifactIds' | 'revision' | 'updatedAt'> {
	const raw: unknown = JSON.parse(operation.bindingJson);
	if (typeof raw !== 'object' || raw === null || !('kind' in raw)) {
		throw new InvalidAgentPayload();
	}
	if (raw.kind === 'native') {
		const row = agentRecord(raw, [
			'kind',
			'name',
			'version',
			'summary',
			'risk',
			'mutation',
			'capability',
			'requiredCapabilities',
			'target',
		]);
		const capability = AGENT_CAPABILITIES.find((value) => value === row.capability);
		const risk = AGENT_APPROVAL_RISKS.find((value) => value === row.risk);
		if (!capability || !risk || typeof row.mutation !== 'boolean' || !Array.isArray(row.requiredCapabilities)) {
			throw new InvalidAgentPayload();
		}
		for (const value of row.requiredCapabilities) {
			if (!AGENT_CAPABILITIES.some((capability) => capability === value)) {
				throw new InvalidAgentPayload();
			}
		}
		const selected = row.target === null ? null : agentRecord(row.target, ['id', 'version', 'fingerprint']);
		if (selected !== null) {
			pluginContractText(selected.fingerprint);
		}
		const name = pluginContractText(row.name);
		if (operation.label !== name) {
			throw new Error('Native operation provenance mismatch');
		}
		return {
			identity: { kind: 'host', operation: name },
			name,
			version: pluginContractText(row.version),
			summary: pluginContractText(row.summary),
			capability,
			risk,
			mutation: row.mutation,
			target:
				selected === null
					? null
					: { id: agentInteger(selected.id, 1), version: agentInteger(selected.version, 1) },
		};
	}
	if (raw.kind === 'registry') {
		const row = agentRecord(raw, [
			'kind',
			'binding',
			'package',
			'key',
			'summary',
			'contract',
			'apiVersion',
			'capabilities',
		]);
		readAgentPluginBinding(row.binding);
		pluginContractText(row.contract);
		agentInteger(row.apiVersion, 1);
		const source = readAgentPluginPackageReference(row.package);
		const key = pluginContractText(row.key);
		if (
			key !== operation.label ||
			!Array.isArray(row.capabilities) ||
			row.capabilities.some((value) => !AGENT_CAPABILITIES.some((capability) => capability === value))
		) {
			throw new Error('Registry operation provenance mismatch');
		}
		return {
			identity: {
				kind: 'plugin',
				packageId: source.packageId,
				packageVersion: source.version,
				packageSha256: source.packageHash,
				name: key,
			},
			name: key,
			version: source.version,
			summary: pluginContractText(row.summary),
			capability: 'plugin.invoke',
			risk: 'read',
			mutation: false,
			target: null,
		};
	}
	if (raw.kind === 'configuration') {
		const row = agentRecord(raw, [
			'kind',
			'instanceId',
			'package',
			'packageRevision',
			'configurationRevision',
			'schemaRevision',
		]);
		const source = readAgentPluginPackageReference(row.package);
		return {
			identity: { kind: 'host', operation: 'plugin.configuration.write' },
			name: operation.label,
			version: source.version,
			summary: pluginContractText(row.instanceId),
			capability: 'plugin.configure',
			risk: 'mutate',
			mutation: true,
			target: null,
		};
	}
	throw new InvalidAgentPayload();
}

/** Reading captured data requires the original immutable capability declarations as well as current grants. */
export function operationCapabilities(operation: StoredOperation): AgentCapability[] {
	const raw: unknown = JSON.parse(operation.bindingJson);
	if (typeof raw !== 'object' || raw === null || !('kind' in raw)) {
		throw new InvalidAgentPayload();
	}
	if (raw.kind === 'model') {
		return ['plugin.invoke'];
	}
	const presentation = operationPresentation(operation);
	const required =
		raw.kind === 'registry' && 'capabilities' in raw
			? raw.capabilities
			: raw.kind === 'native' && 'requiredCapabilities' in raw
				? raw.requiredCapabilities
				: [];
	if (!Array.isArray(required)) {
		throw new InvalidAgentPayload();
	}
	const capabilities = required.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (!capability) {
			throw new InvalidAgentPayload();
		}
		return capability;
	});
	return [...new Set([presentation.capability, ...capabilities])];
}

import { agentInteger, agentRecord, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { readAgentPluginPackageInstallation, readAgentPluginPackageReference } from './http-codec.js';
import { AGENT_PLUGIN_MAX_BODY_BYTES, AGENT_PLUGIN_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentPluginPackageUpdateDependency } from './model.js';
import type {
	AgentPluginPackageUpdateRequest,
	AgentPluginPackageUpdatePreparation,
	AgentPluginPackageUpdateCancellationRequest,
} from './http.js';

function dependencies(input: unknown): AgentPluginPackageUpdateDependency[] {
	if (!Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const values = input.map((input) => {
		const row = agentRecord(input, ['package', 'installationRevision']);
		return {
			package: readAgentPluginPackageReference(row.package),
			installationRevision: agentInteger(row.installationRevision, 1),
		};
	});
	if (new Set(values.map((item) => item.package.packageId)).size !== values.length) {
		throw new InvalidAgentPayload();
	}
	return values;
}

export function readAgentPluginPackageUpdate(input: unknown): AgentPluginPackageUpdateRequest {
	const row = agentRecord(
		input,
		['expectedRevision', 'stageId', 'expectedStageVersion', 'dependencies'],
		AGENT_PLUGIN_MAX_BODY_BYTES,
	);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1),
		stageId: readAgentId(row.stageId),
		expectedStageVersion: agentInteger(row.expectedStageVersion, 1),
		dependencies: dependencies(row.dependencies),
	};
}

export function readAgentPluginPackageUpdatePreparation(
	input: unknown,
	packageId?: string,
): AgentPluginPackageUpdatePreparation {
	const row = agentRecord(input, ['installation', 'dependencies'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	const installation = readAgentPluginPackageInstallation(row.installation);
	const values = dependencies(row.dependencies);
	if (
		(installation.status !== 'installed' && installation.status !== 'draining') ||
		(packageId !== undefined && installation.packageId !== packageId) ||
		values.some((item) => item.package.packageId === installation.packageId)
	) {
		throw new InvalidAgentPayload();
	}
	return { installation, dependencies: values };
}

export function readAgentPluginPackageUpdateCancellation(input: unknown): AgentPluginPackageUpdateCancellationRequest {
	const row = agentRecord(input, ['expectedRevision'], AGENT_PLUGIN_MAX_BODY_BYTES);
	return { expectedRevision: agentInteger(row.expectedRevision, 1) };
}

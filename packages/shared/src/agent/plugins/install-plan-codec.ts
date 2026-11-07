import { satisfies } from 'semver';
import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import {
	readAgentPluginAppBinding,
	readAgentPluginManifest,
	readAgentPluginPackageInstallation,
	readAgentPluginPackageReference,
	readAgentPluginStageView,
} from './http-codec.js';
import { readAgentPluginRepositoryUrl } from './repository-http-codec.js';
import { AGENT_PLUGIN_MAX_BODY_BYTES, AGENT_PLUGIN_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentPluginPackageReference } from './model.js';
import type {
	AgentPluginInstallPlan,
	AgentPluginInstallPlanDependency,
	AgentPluginInstallPlanDependencyRequest,
	AgentPluginInstallPlanRequest,
	AgentPluginInstallPlanResponse,
	AgentPluginInstallPlanStage,
	AgentPluginInstallPlanStagedRequest,
} from './install-plan.js';

function stage(input: unknown): AgentPluginInstallPlanStage {
	const value = readAgentPluginStageView(input);
	if (
		(value.status !== 'verified' && value.status !== 'installed') ||
		value.manifest === null ||
		value.publisherKeyId === null
	) {
		throw new InvalidAgentPayload();
	}
	return {
		id: value.id,
		packageHash: value.packageHash,
		sizeBytes: value.sizeBytes,
		status: value.status,
		version: value.version,
		publisherKeyId: value.publisherKeyId,
		manifest: value.manifest,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function dependency(input: unknown): AgentPluginInstallPlanDependency {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'staged'
			? ['kind', 'repositoryUrl', 'stage', 'expectedInstallationRevision']
			: ['kind', 'installation', 'manifest'],
		AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	);
	if (row.kind === 'staged') {
		return {
			kind: 'staged',
			repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl),
			stage: stage(row.stage),
			expectedInstallationRevision:
				row.expectedInstallationRevision === null ? null : agentInteger(row.expectedInstallationRevision, 1),
		};
	}
	if (row.kind !== 'installed') {
		throw new InvalidAgentPayload();
	}
	const installation = readAgentPluginPackageInstallation(row.installation);
	const manifest = readAgentPluginManifest(row.manifest);
	if (
		installation.status !== 'installed' ||
		installation.packageId !== manifest.id ||
		installation.version !== manifest.version
	) {
		throw new InvalidAgentPayload();
	}
	return { kind: 'installed', installation, manifest };
}

export function readAgentPluginInstallPlan(input: unknown): AgentPluginInstallPlan {
	const row = agentRecord(input, ['repositoryVersion', 'target', 'dependencies'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	const target = agentRecord(
		row.target,
		['repositoryUrl', 'stage', 'expectedInstallationRevision'],
		AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	);
	if (!Array.isArray(row.dependencies)) {
		throw new InvalidAgentPayload();
	}
	const selected = stage(target.stage);
	const dependencies = row.dependencies.map(dependency);
	const identities = dependencies.map((item) =>
		item.kind === 'staged'
			? {
					packageId: item.stage.manifest.id,
					version: item.stage.manifest.version,
					publisherKeyId: item.stage.publisherKeyId,
					manifest: item.stage.manifest,
				}
			: {
					packageId: item.installation.packageId,
					version: item.installation.version,
					publisherKeyId: item.installation.publisherKeyId,
					manifest: item.manifest,
				},
	);
	if (
		new Set(identities.map((item) => item.packageId)).size !== identities.length ||
		identities.some((item) => item.packageId === selected.manifest.id)
	) {
		throw new InvalidAgentPayload();
	}
	const visited = new Set([selected.manifest.id]);
	const pending = [...selected.manifest.dependencies];
	while (pending.length) {
		const required = pending.pop();
		if (!required) {
			throw new InvalidAgentPayload();
		}
		const found = identities.find((identity) => identity.packageId === required.packageId);
		if (
			!found ||
			found.publisherKeyId !== required.publisherKeyId ||
			!satisfies(found.version, '>=' + required.minVersion + ' <=' + required.maxVersion)
		) {
			throw new InvalidAgentPayload();
		}
		if (!visited.has(found.packageId)) {
			visited.add(found.packageId);
			pending.push(...found.manifest.dependencies);
		}
	}
	if (visited.size !== identities.length + 1) {
		throw new InvalidAgentPayload();
	}
	return {
		repositoryVersion: agentInteger(row.repositoryVersion),
		target: {
			repositoryUrl: readAgentPluginRepositoryUrl(target.repositoryUrl),
			stage: selected,
			expectedInstallationRevision:
				target.expectedInstallationRevision === null
					? null
					: agentInteger(target.expectedInstallationRevision, 1),
		},
		dependencies,
	};
}

function stagedRequest(input: unknown, withKind: boolean): AgentPluginInstallPlanStagedRequest {
	const row = agentRecord(
		input,
		withKind
			? ['kind', 'repositoryUrl', 'stageId', 'expectedVersion', 'expectedInstallationRevision', 'package']
			: ['repositoryUrl', 'stageId', 'expectedVersion', 'expectedInstallationRevision', 'package'],
	);
	return {
		repositoryUrl: readAgentPluginRepositoryUrl(row.repositoryUrl),
		stageId: readAgentId(row.stageId),
		expectedVersion: agentInteger(row.expectedVersion, 1),
		expectedInstallationRevision:
			row.expectedInstallationRevision === null ? null : agentInteger(row.expectedInstallationRevision, 1),
		package: readAgentPluginPackageReference(row.package),
	};
}

function dependencyRequest(input: unknown): AgentPluginInstallPlanDependencyRequest {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'staged'
			? ['kind', 'repositoryUrl', 'stageId', 'expectedVersion', 'expectedInstallationRevision', 'package']
			: ['kind', 'expectedRevision', 'package'],
	);
	if (row.kind === 'staged') {
		const value = stagedRequest(row, true);
		return {
			kind: 'staged',
			repositoryUrl: value.repositoryUrl,
			stageId: value.stageId,
			expectedVersion: value.expectedVersion,
			expectedInstallationRevision: value.expectedInstallationRevision,
			package: value.package,
		};
	}
	if (row.kind !== 'installed') {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'installed',
		expectedRevision: agentInteger(row.expectedRevision, 1),
		package: readAgentPluginPackageReference(row.package),
	};
}

export function readAgentPluginInstallPlanRequest(input: unknown): AgentPluginInstallPlanRequest {
	const row = agentRecord(
		input,
		['initialization', 'repositoryVersion', 'target', 'dependencies'],
		AGENT_PLUGIN_MAX_BODY_BYTES,
	);
	if (
		!Array.isArray(row.dependencies) ||
		(row.initialization !== 'disabled' && row.initialization !== 'declared_grants')
	) {
		throw new InvalidAgentPayload();
	}
	const target = stagedRequest(row.target, false);
	const dependencies = row.dependencies.map(dependencyRequest);
	if (
		new Set(dependencies.map((item) => item.package.packageId)).size !== dependencies.length ||
		dependencies.some((item) => item.package.packageId === target.package.packageId)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		initialization: row.initialization,
		repositoryVersion: agentInteger(row.repositoryVersion),
		target,
		dependencies,
	};
}

function samePackage(left: AgentPluginPackageReference, right: AgentPluginPackageReference): boolean {
	return (
		left.packageId === right.packageId &&
		left.version === right.version &&
		left.packageHash === right.packageHash &&
		left.publisherKeyId === right.publisherKeyId
	);
}

export function readAgentPluginInstallPlanResponse(
	input: unknown,
	request?: AgentPluginInstallPlanRequest,
): AgentPluginInstallPlanResponse {
	const row = agentRecord(input, ['installation', 'binding'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	const installation = readAgentPluginPackageInstallation(row.installation);
	const binding = row.binding === null ? null : readAgentPluginAppBinding(row.binding);
	if (
		installation.status !== 'installed' ||
		(request !== undefined && !samePackage(installation, request.target.package)) ||
		(binding !== null && !samePackage(binding.app, installation))
	) {
		throw new InvalidAgentPayload();
	}
	return { installation, binding };
}

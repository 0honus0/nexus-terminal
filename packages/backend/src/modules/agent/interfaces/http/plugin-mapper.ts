import { toPluginConfiguration, toPluginInstanceSettings } from '../plugin/plugin-configuration-mapper.js';

import {
	AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
	AGENT_PLUGIN_SDK_VERSION,
	AGENT_PLUGIN_PROTOCOL_VERSION,
} from '@nexus-terminal/shared/agent/plugins/values';
import { AgentFailure } from '../../agent-failure.js';
import type { AgentPluginPackageUpdatePreparation } from '@nexus-terminal/shared/agent/plugins/http';
import type { AgentPluginPackageUpdateDependency } from '@nexus-terminal/shared/agent/plugins/model';
import type {
	PluginPackageUpdatePreparation,
	PluginPackageUpdateDependency,
} from '../../plugins/model/plugin-composition-types.js';
import type { PluginInstallPlanStage } from '../../plugins/model/plugin-repository-types.js';
import type { AgentPluginInstallPlanStage } from '@nexus-terminal/shared/agent/plugins/install-plan';

import type { AgentPluginContribution } from '@nexus-terminal/shared/agent/plugins/agent-extension';
import type { PluginSignedContribution } from '../../plugins/model/plugin-manifest-types.js';
import type {
	PluginAppBinding,
	PluginPackageInstallation,
	PluginPackageReference,
} from '../../plugins/model/plugin-composition-types.js';
import type {
	AgentPluginAppBinding,
	AgentPluginPackageInstallation,
	AgentPluginPackageReference,
} from '@nexus-terminal/shared/agent/plugins/model';
import type { AgentPluginRuntimeObservation } from '@nexus-terminal/shared/agent/plugins/runtime-model';
import type { AgentPluginInstallationListResponse } from '@nexus-terminal/shared/agent/plugins/http';
import type { PluginInstallationDirectory } from '../../plugins/model/plugin-types.js';
import type { PluginRuntimeObservation } from '../../plugins/model/plugin-types.js';
import { toPluginIntentInput, toPluginIntent } from './plugin-intent-mapper.js';
import { toArtifactView } from './artifact-mapper.js';
import type {
	AgentPluginCatalog,
	AgentPluginRepositorySettings,
	AgentPluginRecommended,
} from '@nexus-terminal/shared/agent/plugins/repository-model';
import type { PluginCatalog, PluginRepositorySettings, PluginRecommended } from '../../plugins/model/plugin-types.js';

import type {
	AgentPluginFrontendInput,
	AgentPluginFrontendResult,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { isAgentPluginAgentInput, isAgentPluginUiInput } from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import type { PluginFrontendInput, PluginFrontendResult } from '../../plugins/model/plugin-agent-types.js';
import { isPluginAgentResult } from '../../plugins/model/plugin-agent-types.js';
import { isUiWorkspaceResult } from '../../scope/model/workspace-types.js';
import { fromWorkspace, toWorkspace, fromUiWorkspace, toUiWorkspace } from './workspace-mapper.js';
import type {
	AgentPluginDataPurge,
	AgentPluginData,
	AgentPluginPublisher,
	AgentPluginStage,
	AgentPluginManifest,
	AgentPluginInstallation,
	AgentPluginVersion,
	AgentPluginDescriptor,
} from '@nexus-terminal/shared/agent/plugins/model';
import {
	AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	AGENT_PLUGIN_FRONTEND_SANDBOX,
	AGENT_PLUGIN_RPC_TIMEOUT_MS,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	PluginDataPurge,
	PluginData,
	PluginPublisher,
	PluginStage,
	PluginManifest,
	PluginInstallation,
	PluginVersion,
	PluginFrontendDescriptor,
} from '../../plugins/model/plugin-types.js';

export function toManifest(value: PluginManifest): AgentPluginManifest {
	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		compatibility: {
			host: { minVersion: value.compatibility.host.minVersion, maxVersion: value.compatibility.host.maxVersion },
			backendSdk: value.compatibility.backendSdk,
			frontendSdk: value.compatibility.frontendSdk,
		},
		dependencies: value.dependencies.map((item) => ({
			packageId: item.packageId,
			publisherKeyId: item.publisherKeyId,
			minVersion: item.minVersion,
			maxVersion: item.maxVersion,
		})),
		contributions: toPluginContribution(value.contributions),
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
		namespaces: value.namespaces.map((namespace) => namespace),
	};
}

export function toPluginPackageReference(value: PluginPackageReference): AgentPluginPackageReference {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function toPluginPackageInstallation(value: PluginPackageInstallation): AgentPluginPackageInstallation {
	return {
		packageId: value.package.packageId,
		version: value.package.version,
		packageHash: value.package.packageHash,
		publisherKeyId: value.package.publisherKeyId,
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toPluginAppBinding(value: PluginAppBinding): AgentPluginAppBinding {
	return {
		appId: value.appId,
		executionRevision: value.executionRevision,
		uiRevision: value.uiRevision,
		app: toPluginPackageReference(value.app),
		dependencies: value.dependencies.map(toPluginPackageReference),
		selectedRootIds: value.selectedRootIds.map((id) => id),
		ui: value.ui ? toPluginPackageReference(value.ui) : null,
	};
}

export function toPluginPublisher(value: PluginPublisher): AgentPluginPublisher {
	return {
		keyId: value.keyId,
		publicKeyPem: value.publicKeyPem,
		label: value.label,
		version: value.version,
		createdAt: value.createdAt,
		revokedAt: value.revokedAt,
	};
}

export function toPluginStage(value: PluginInstallPlanStage): AgentPluginInstallPlanStage;

export function toPluginStage(value: PluginStage): AgentPluginStage;

export function toPluginStage(value: PluginStage): AgentPluginStage {
	return {
		id: value.id,
		packageHash: value.packageHash,
		sizeBytes: value.sizeBytes,
		status: value.status,
		version: value.version,
		publisherKeyId: value.publisherKeyId,
		manifest: value.manifest === null ? null : toManifest(value.manifest),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toPluginInstallation(value: PluginInstallation): AgentPluginInstallation {
	return {
		appId: value.appId,
		definitionId: value.definitionId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toPluginInstallationList(value: PluginInstallationDirectory): AgentPluginInstallationListResponse {
	return {
		items: value.installations.map(toPluginInstallation),
		retainedAppIds: value.retainedAppIds.map((id) => id),
	};
}

export function toPluginVersion(value: PluginVersion): AgentPluginVersion {
	return {
		manifest: toManifest(value.manifest),
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function toPluginDescriptor(value: PluginFrontendDescriptor): AgentPluginDescriptor {
	return {
		purpose: value.purpose,
		instanceId: value.instanceId,
		appId: value.appId,
		version: value.version,
		url: '/plugins/' + value.appId + '/' + value.version + '/' + value.grant + '/' + value.entry,
		sdkVersion: AGENT_PLUGIN_SDK_VERSION,
		protocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
		package: toPluginPackageReference(value.package),
		uiRevision: value.uiRevision,
		sandbox: AGENT_PLUGIN_FRONTEND_SANDBOX,
		maxMessageBytes: AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
		requestTimeoutMs: AGENT_PLUGIN_RPC_TIMEOUT_MS,
		expiresAt: value.expiresAt,
	};
}

export function toPluginData(value: PluginData): AgentPluginData {
	return { key: value.key, version: value.version, valueJson: value.valueJson, updatedAt: value.updatedAt };
}

export function fromPluginRpc(value: AgentPluginFrontendInput): PluginFrontendInput {
	if (isAgentPluginUiInput(value)) {
		return fromUiWorkspace(value);
	}
	if (isAgentPluginAgentInput(value)) {
		return fromWorkspace(value);
	}
	switch (value.method) {
		case 'settings.read':
			return { method: value.method };
		case 'settings.write':
			return {
				method: value.method,
				command: {
					operationKey: value.params.operationKey,
					expectedPackageRevision: value.params.expectedPackageRevision,
					expectedRevision: value.params.expectedRevision,
					schemaRevision: value.params.schemaRevision,
					documentJson: value.params.documentJson,
				},
			};
		case 'host.perform':
			throw new AgentFailure('forbidden');
		case 'intents.create':
			return { method: value.method, input: toPluginIntentInput(value.params) };
		case 'intents.listReceived':
			return { method: value.method, limit: value.params.limit };
		case 'intents.revoke':
			return { method: value.method, receiptId: value.params.receiptId };
		case 'intents.artifacts.get':
			return { method: value.method, receiptId: value.params.receiptId, artifactId: value.params.artifactId };
		case 'intents.artifacts.readRange':
			return {
				method: value.method,
				receiptId: value.params.receiptId,
				artifactId: value.params.artifactId,
				start: value.params.start,
				endInclusive: value.params.endInclusive,
			};
		case 'host.appInfo':
			return { method: value.method };
		case 'storage.get':
			return { method: value.method, key: value.params.key };
		case 'storage.put':
			return {
				method: value.method,
				key: value.params.key,
				expectedVersion: value.params.expectedVersion,
				operationId: value.params.operationId,
				valueJson: value.params.valueJson,
			};
		case 'storage.delete':
			return {
				method: value.method,
				key: value.params.key,
				expectedVersion: value.params.expectedVersion,
				operationId: value.params.operationId,
			};
	}
}

export function toPluginRpc(value: PluginFrontendResult): AgentPluginFrontendResult {
	if (value.method === 'settings.read') {
		return { method: value.method, value: toPluginInstanceSettings(value.value) };
	}
	if (value.method === 'settings.write') {
		return { method: value.method, value: toPluginConfiguration(value.value) };
	}
	if (isPluginAgentResult(value)) {
		if (isUiWorkspaceResult(value)) {
			return toUiWorkspace(value);
		}
		return toWorkspace(value);
	}
	if (value.method === 'host.perform') {
		throw new AgentFailure('forbidden');
	}
	if (value.method === 'intents.create') {
		return { method: value.method, value: toPluginIntent(value.value) };
	}
	if (value.method === 'intents.listReceived') {
		return { method: value.method, value: value.value.map(toPluginIntent) };
	}
	if (value.method === 'intents.revoke') {
		return { method: value.method, value: { revoked: true } };
	}
	if (value.method === 'intents.artifacts.get') {
		return { method: value.method, value: toArtifactView(value.value) };
	}
	if (value.method === 'intents.artifacts.readRange') {
		const item = value.value;
		return {
			method: value.method,
			value: {
				receiptId: item.receiptId,
				artifactId: item.artifactId,
				start: item.start,
				endInclusive: item.endInclusive,
				dataBase64: Buffer.from(item.bytes).toString('base64'),
			},
		};
	}
	if (value.method === 'host.appInfo') {
		return { method: value.method, value: toPluginInstallation(value.value) };
	}
	if (value.method === 'storage.get') {
		return { method: value.method, value: value.value === null ? null : toPluginData(value.value) };
	}
	return { method: value.method, value: toPluginData(value.value) };
}

export function toPluginDataPurge(value: PluginDataPurge): AgentPluginDataPurge {
	return { revision: value.revision, deletedKeys: value.deletedKeys, updatedAt: value.updatedAt };
}

export function toPluginRepositorySettings(value: PluginRepositorySettings): AgentPluginRepositorySettings {
	return {
		version: value.version,
		repositories: value.repositories.map((item) => ({ url: item.url })),
		updatedAt: value.updatedAt,
	};
}

export function toPluginCatalog(value: PluginCatalog): AgentPluginCatalog {
	return {
		schemaVersion: 2,
		repositoryUrl: value.repositoryUrl,
		publishers: value.publishers.map((item) => ({
			keyId: item.keyId,
			label: item.label,
			publicKeyPem: item.publicKeyPem,
		})),
		packages: value.packages.map((item) => ({
			packageId: item.packageId,
			version: item.version,
			compatibility: {
				host: {
					minVersion: item.compatibility.host.minVersion,
					maxVersion: item.compatibility.host.maxVersion,
				},
				backendSdk: item.compatibility.backendSdk,
				frontendSdk: item.compatibility.frontendSdk,
			},
			contributionKinds: item.contributionKinds.map((kind) => kind),

			displayName: item.displayName,
			description: item.description,
			localizations: item.localizations?.map((item) => ({
				locale: item.locale,
				displayName: item.displayName,
				description: item.description,
			})),
			packageUrl: item.packageUrl,
			sha256: item.sha256,
			sizeBytes: item.sizeBytes,
			publisherKeyId: item.publisherKeyId,
			compatible: item.compatible,
			compatibilityReason: item.compatibilityReason,
		})),
	};
}

export function toPluginRecommended(value: PluginRecommended): AgentPluginRecommended {
	const entry = value.entry;
	return {
		installation: value.installation === null ? null : toPluginInstallation(value.installation),
		entry:
			entry === null
				? null
				: {
						packageId: entry.packageId,
						version: entry.version,
						compatibility: {
							host: {
								minVersion: entry.compatibility.host.minVersion,
								maxVersion: entry.compatibility.host.maxVersion,
							},
							backendSdk: entry.compatibility.backendSdk,
							frontendSdk: entry.compatibility.frontendSdk,
						},
						contributionKinds: entry.contributionKinds.map((kind) => kind),

						displayName: entry.displayName,
						description: entry.description,
						localizations: entry.localizations?.map((item) => ({
							locale: item.locale,
							displayName: item.displayName,
							description: item.description,
						})),
						packageUrl: entry.packageUrl,
						sha256: entry.sha256,
						sizeBytes: entry.sizeBytes,
						publisherKeyId: entry.publisherKeyId,
						compatible: entry.compatible,
						compatibilityReason: entry.compatibilityReason,
					},
	};
}

export function toPluginRuntimeObservation(value: PluginRuntimeObservation): AgentPluginRuntimeObservation {
	return {
		appId: value.appId,
		instanceId: value.instanceId,
		revision: value.revision,
		state: value.state,
		updatedAt: value.updatedAt,
		unknownAt: value.unknownAt,
		acknowledgedAt: value.acknowledgedAt,
	};
}

function toPluginContribution(value: PluginSignedContribution): AgentPluginContribution {
	return {
		app:
			value.app === null
				? null
				: { entry: value.app.entry, uiContract: value.app.uiContract, uiApiVersion: value.app.uiApiVersion },
		tools: value.tools,
		services: value.services,
		ui: value.ui === null ? null : { contract: value.ui.contract, apiVersion: value.ui.apiVersion },
		settings:
			value.settings === null
				? null
				: {
						frontendEntry: value.settings.frontendEntry,
						instructions: value.settings.instructions,
						schemaRevision: value.settings.schemaRevision,
						schemaJson: value.settings.schemaJson,
						defaultsJson: value.settings.defaultsJson,
						agentEditablePaths: value.settings.agentEditablePaths.map((path) => path),
					},
		skills: value.skills.map((skill) => ({ id: skill.id, path: skill.path })),
	};
}

export function fromPluginPackageUpdateDependencies(
	value: AgentPluginPackageUpdateDependency[],
): PluginPackageUpdateDependency[] {
	return value.map((item) => ({
		installationRevision: item.installationRevision,
		package: {
			packageId: item.package.packageId,
			version: item.package.version,
			packageHash: item.package.packageHash,
			publisherKeyId: item.package.publisherKeyId,
		},
	}));
}

export function toPluginPackageUpdatePreparation(
	value: PluginPackageUpdatePreparation,
): AgentPluginPackageUpdatePreparation {
	return {
		installation: toPluginPackageInstallation(value.installation),
		dependencies: value.dependencies.map((item) => ({
			installationRevision: item.installationRevision,
			package: toPluginPackageReference(item.package),
		})),
	};
}

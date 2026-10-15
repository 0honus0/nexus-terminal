import type { AgentPluginRuntimeObservation } from '@nexus-terminal/shared/agent/plugins/runtime-model';
import type { PluginRuntimeObservation } from '../../plugins/model/plugin-types.js';
import { toPluginIntentInput, toPluginIntent } from './plugin-intent-mapper.js';
import { toArtifactView } from './artifact-mapper.js';
import type {
	AgentPluginCatalog,
	AgentPluginRepositorySettings,
	AgentPluginRecommended,
} from '@nexus-terminal/shared/agent/plugins/repository-model';
import type { PluginCatalog, PluginRepositorySettings, PluginRecommended } from '../../plugins/model/plugin-types.js';
import type { AgentPluginRpcInput, AgentPluginRpcResult } from '@nexus-terminal/shared/agent/plugins/events';
import type { PluginRpcInput, PluginRpcResult } from '../../plugins/model/plugin-types.js';
import type {
	AgentPluginFrontendInput,
	AgentPluginFrontendResult,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { isAgentPluginAgentInput } from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import type { PluginFrontendInput, PluginFrontendResult } from '../../plugins/model/plugin-agent-types.js';
import { isPluginAgentResult } from '../../plugins/model/plugin-agent-types.js';
import { fromPluginAgent, toPluginAgent } from './plugin-agent-mapper.js';
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
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
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

function toManifest(value: PluginManifest): AgentPluginManifest {
	return {
		schemaVersion: 1,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		sdkVersion: value.sdkVersion,
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
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

export function toPluginVersion(value: PluginVersion): AgentPluginVersion {
	return {
		manifest: toManifest(value.manifest),
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function toPluginDescriptor(value: PluginFrontendDescriptor): AgentPluginDescriptor {
	return {
		appId: value.appId,
		version: value.version,
		url: '/plugins/' + value.appId + '/' + value.version + '/' + value.grant + '/' + value.entry,
		sdkVersion: '1',
		protocolVersion: 1,
		sandbox: 'allow-scripts',
		maxMessageBytes: AGENT_PLUGIN_MAX_MESSAGE_BYTES,
		requestTimeoutMs: AGENT_PLUGIN_RPC_TIMEOUT_MS,
		expiresAt: value.expiresAt,
	};
}

export function toPluginData(value: PluginData): AgentPluginData {
	return { key: value.key, version: value.version, valueJson: value.valueJson, updatedAt: value.updatedAt };
}

export function fromPluginRpc(value: AgentPluginFrontendInput): PluginFrontendInput {
	if (isAgentPluginAgentInput(value)) {
		return fromPluginAgent(value);
	}
	switch (value.method) {
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
	if (isPluginAgentResult(value)) {
		return toPluginAgent(value);
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
		schemaVersion: 1,
		repositoryUrl: value.repositoryUrl,
		publishers: value.publishers.map((item) => ({
			keyId: item.keyId,
			label: item.label,
			publicKeyPem: item.publicKeyPem,
		})),
		packages: value.packages.map((item) => ({
			appId: item.appId,
			version: item.version,
			sdkVersion: item.sdkVersion,
			nexus: { minVersion: item.nexus.minVersion, maxVersion: item.nexus.maxVersion },
			displayName: item.displayName,
			description: item.description,
			packageUrl: item.packageUrl,
			sha256: item.sha256,
			sizeBytes: item.sizeBytes,
			publisherKeyId: item.publisherKeyId,
			compatible: item.compatible,
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
						appId: entry.appId,
						version: entry.version,
						sdkVersion: entry.sdkVersion,
						nexus: { minVersion: entry.nexus.minVersion, maxVersion: entry.nexus.maxVersion },
						displayName: entry.displayName,
						description: entry.description,
						packageUrl: entry.packageUrl,
						sha256: entry.sha256,
						sizeBytes: entry.sizeBytes,
						publisherKeyId: entry.publisherKeyId,
						compatible: entry.compatible,
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

import { agentRecord, agentText, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_CAPABILITIES } from '../governance/values.js';
import {
	AGENT_PLUGIN_MAX_DATA_KEY_BYTES,
	AGENT_PLUGIN_MAX_DATA_VALUE_BYTES,
	AGENT_PLUGIN_STAGE_STATUSES,
	AGENT_PLUGIN_INSTALLATION_STATUSES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	AGENT_PLUGIN_MAX_ENTRY_BYTES,
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	AGENT_PLUGIN_RPC_TIMEOUT_MS,
} from './values.js';
import type {
	AgentPluginDataPurge,
	AgentPluginData,
	AgentPluginPublisher,
	AgentPluginManifest,
	AgentPluginStage,
	AgentPluginInstallation,
	AgentPluginVersion,
	AgentPluginDescriptor,
} from './model.js';
import type {
	AgentPluginDataPurgeRequest,
	AgentPluginDataRequest,
	AgentPluginDataDeleteRequest,
	AgentPluginPublisherRequest,
	AgentPluginStageRequest,
	AgentPluginInstallRequest,
	AgentPluginUpgradeRequest,
	AgentPluginRetirementRequest,
} from './http.js';

export function readAgentPluginRetirement(input: unknown): AgentPluginRetirementRequest {
	const row = agentRecord(input, ['expectedRevision']);
	return { expectedRevision: agentInteger(row.expectedRevision, 1) };
}

export function readAgentPluginUpgrade(input: unknown): AgentPluginUpgradeRequest {
	const row = agentRecord(input, ['expectedRevision', 'stageId', 'expectedStageVersion']);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1),
		stageId: readAgentId(row.stageId),
		expectedStageVersion: agentInteger(row.expectedStageVersion, 1),
	};
}

export function readAgentPluginPublisher(input: unknown): AgentPluginPublisherRequest {
	const row = agentRecord(input, ['label', 'publicKeyPem']);
	return { label: agentText(row.label, 128), publicKeyPem: agentText(row.publicKeyPem, 16384) };
}

export function readAgentPluginStage(input: unknown): AgentPluginStageRequest {
	const row = agentRecord(input, ['artifactAppId', 'artifactId', 'expectedVersion']);
	return {
		artifactAppId: readAgentId(row.artifactAppId),
		artifactId: readAgentId(row.artifactId),
		expectedVersion: agentInteger(row.expectedVersion, 1),
	};
}

export function readAgentPluginInstall(input: unknown): AgentPluginInstallRequest {
	const row = agentRecord(input, ['stageId', 'expectedVersion']);
	return { stageId: readAgentId(row.stageId), expectedVersion: agentInteger(row.expectedVersion, 1) };
}

export function readAgentPluginVersion(input: unknown): number {
	return agentInteger(agentRecord(input, ['expectedVersion']).expectedVersion, 1);
}

function keyId(input: unknown): string {
	const value = agentText(input, 72);
	if (!/^ed25519:[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function hash(input: unknown): string {
	const value = agentText(input, 64);
	if (!/^[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function version(input: unknown): string {
	const value = agentText(input, 64);
	if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function entry(input: unknown, prefix: string): string | null {
	if (input === null) {
		return null;
	}
	const value = agentText(input, AGENT_PLUGIN_MAX_ENTRY_BYTES);
	if (
		!value.startsWith(prefix + '/') ||
		value.split('/').some((part) => part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
	) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginManifest(input: unknown): AgentPluginManifest {
	const row = agentRecord(
		input,
		[
			'schemaVersion',
			'id',
			'version',
			'displayName',
			'sdkVersion',
			'capabilities',
			'intents',
			'frontendEntry',
			'backendEntry',
		],
		AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	);
	if (
		row.schemaVersion !== 1 ||
		row.sdkVersion !== '1' ||
		!Array.isArray(row.capabilities) ||
		row.capabilities.length > AGENT_CAPABILITIES.length ||
		!Array.isArray(row.intents) ||
		row.intents.length > 128
	) {
		throw new InvalidAgentPayload();
	}
	const id = agentText(row.id, 128);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(id)) {
		throw new InvalidAgentPayload();
	}
	const capabilities = row.capabilities.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (!capability) {
			throw new InvalidAgentPayload();
		}
		return capability;
	});
	const intents = row.intents.map((value) => {
		const item = agentRecord(value, ['id', 'schemaVersion']);
		return { id: agentText(item.id, 128), schemaVersion: agentInteger(item.schemaVersion, 1) };
	});
	if (
		new Set(capabilities).size !== capabilities.length ||
		new Set(intents.map((item) => item.id)).size !== intents.length
	) {
		throw new InvalidAgentPayload();
	}
	return {
		schemaVersion: 1,
		id,
		version: version(row.version),
		displayName: agentText(row.displayName, 128),
		sdkVersion: '1',
		capabilities,
		intents,
		frontendEntry: entry(row.frontendEntry, 'frontend'),
		backendEntry: entry(row.backendEntry, 'backend'),
	};
}

export function readAgentPluginPublisherView(input: unknown): AgentPluginPublisher {
	const row = agentRecord(input, ['keyId', 'publicKeyPem', 'label', 'version', 'createdAt', 'revokedAt']);
	const createdAt = agentInteger(row.createdAt),
		revokedAt = row.revokedAt === null ? null : agentInteger(row.revokedAt, createdAt);
	return {
		keyId: keyId(row.keyId),
		publicKeyPem: agentText(row.publicKeyPem, 16384),
		label: agentText(row.label, 128),
		version: agentInteger(row.version, 1),
		createdAt,
		revokedAt,
	};
}

export function readAgentPluginStageView(input: unknown): AgentPluginStage {
	const row = agentRecord(
		input,
		['id', 'packageHash', 'sizeBytes', 'status', 'version', 'publisherKeyId', 'manifest', 'createdAt', 'updatedAt'],
		AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	);
	const status = AGENT_PLUGIN_STAGE_STATUSES.find((item) => item === row.status);
	if (!status) {
		throw new InvalidAgentPayload();
	}
	const manifest = row.manifest === null ? null : readAgentPluginManifest(row.manifest),
		publisherKeyId = row.publisherKeyId === null ? null : keyId(row.publisherKeyId),
		createdAt = agentInteger(row.createdAt);
	if (
		(manifest === null) !== (publisherKeyId === null) ||
		((status === 'verified' || status === 'installed') && manifest === null)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		packageHash: hash(row.packageHash),
		sizeBytes: agentInteger(row.sizeBytes, 1),
		status,
		version: agentInteger(row.version, 1),
		publisherKeyId,
		manifest,
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

export function readAgentPluginInstallation(input: unknown): AgentPluginInstallation {
	const row = agentRecord(input, [
		'appId',
		'definitionId',
		'version',
		'packageHash',
		'publisherKeyId',
		'status',
		'revision',
		'createdAt',
		'updatedAt',
	]);
	const status = AGENT_PLUGIN_INSTALLATION_STATUSES.find((item) => item === row.status);
	if (!status) {
		throw new InvalidAgentPayload();
	}
	const definitionId = agentText(row.definitionId, 128),
		createdAt = agentInteger(row.createdAt);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(definitionId)) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: readAgentId(row.appId),
		definitionId,
		version: version(row.version),
		packageHash: hash(row.packageHash),
		publisherKeyId: keyId(row.publisherKeyId),
		status,
		revision: agentInteger(row.revision, 1),
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

export function readAgentPluginVersionView(input: unknown): AgentPluginVersion {
	const row = agentRecord(input, ['manifest', 'packageHash', 'publisherKeyId'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	return {
		manifest: readAgentPluginManifest(row.manifest),
		packageHash: hash(row.packageHash),
		publisherKeyId: keyId(row.publisherKeyId),
	};
}

export function readAgentPluginDescriptor(input: unknown): AgentPluginDescriptor {
	const row = agentRecord(input, [
		'appId',
		'version',
		'url',
		'sdkVersion',
		'protocolVersion',
		'sandbox',
		'maxMessageBytes',
		'requestTimeoutMs',
		'expiresAt',
	]);
	if (row.sdkVersion !== '1' || row.protocolVersion !== 1 || row.sandbox !== 'allow-scripts') {
		throw new InvalidAgentPayload();
	}
	const appId = readAgentId(row.appId),
		release = version(row.version),
		url = agentText(row.url, 4096);
	if (
		!url.startsWith('/plugins/' + appId + '/' + release + '/') ||
		url.includes('?') ||
		url.includes('#') ||
		url.includes('\\')
	) {
		throw new InvalidAgentPayload();
	}
	const parts = url.slice(('/plugins/' + appId + '/' + release + '/').length).split('/');
	readAgentId(parts[0]);
	entry(parts.slice(1).join('/'), 'frontend');
	return {
		appId,
		version: release,
		url,
		sdkVersion: '1',
		protocolVersion: 1,
		sandbox: 'allow-scripts',
		maxMessageBytes: agentInteger(row.maxMessageBytes, 1, AGENT_PLUGIN_MAX_MESSAGE_BYTES),
		requestTimeoutMs: agentInteger(row.requestTimeoutMs, 1, AGENT_PLUGIN_RPC_TIMEOUT_MS),
		expiresAt: agentInteger(row.expiresAt, 1),
	};
}

export function readAgentPluginItems<T>(input: unknown, read: (value: unknown) => T): { items: T[] } {
	const row = agentRecord(input, ['items'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > 4096) {
		throw new InvalidAgentPayload();
	}
	return { items: row.items.map(read) };
}

export function readAgentPluginDataKey(input: unknown): string {
	const key = agentText(input, AGENT_PLUGIN_MAX_DATA_KEY_BYTES);
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(key)) {
		throw new InvalidAgentPayload();
	}
	return key;
}

export function readAgentPluginDataDelete(input: unknown): AgentPluginDataDeleteRequest {
	const row = agentRecord(input, ['expectedRevision', 'expectedVersion', 'operationId']);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1),
		expectedVersion: agentInteger(row.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		operationId: readAgentId(row.operationId),
	};
}

export function readAgentPluginDataWrite(input: unknown): AgentPluginDataRequest {
	const row = agentRecord(
		input,
		['expectedRevision', 'expectedVersion', 'operationId', 'valueJson'],
		AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	);
	const valueJson = readAgentPluginDataValue(row.valueJson);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1),
		expectedVersion: agentInteger(row.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1),
		operationId: readAgentId(row.operationId),
		valueJson,
	};
}

export function readAgentPluginDataView(input: unknown): AgentPluginData {
	const row = agentRecord(input, ['key', 'version', 'valueJson', 'updatedAt'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	const valueJson = row.valueJson === null ? null : readAgentPluginDataValue(row.valueJson);
	return {
		key: readAgentPluginDataKey(row.key),
		version: agentInteger(row.version, 1),
		valueJson,
		updatedAt: agentInteger(row.updatedAt),
	};
}

export function readAgentPluginDataPurge(input: unknown): AgentPluginDataPurgeRequest {
	const row = agentRecord(input, ['expectedRevision', 'operationId']);
	return {
		expectedRevision: agentInteger(row.expectedRevision, 1, Number.MAX_SAFE_INTEGER - 1),
		operationId: readAgentId(row.operationId),
	};
}

export function readAgentPluginDataPurgeView(input: unknown): AgentPluginDataPurge {
	const row = agentRecord(input, ['revision', 'deletedKeys', 'updatedAt']);
	return {
		revision: agentInteger(row.revision, 1),
		deletedKeys: agentInteger(row.deletedKeys),
		updatedAt: agentInteger(row.updatedAt),
	};
}

export function readAgentPluginDataValue(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_DATA_VALUE_BYTES);
	try {
		JSON.parse(value);
	} catch {
		throw new InvalidAgentPayload();
	}
	return value;
}

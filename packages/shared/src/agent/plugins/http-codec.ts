import { pluginContractText } from './registry-codec.js';
import {
	AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES,
	AGENT_PLUGIN_MAX_VERSION_BYTES,
	AGENT_PLUGIN_PACKAGE_HASH_LENGTH,
} from './package-values.js';
import { compare } from 'semver';

import type { AgentPluginContribution } from './agent-extension.js';
import {
	isAgentRecord,
	agentRecord,
	agentText,
	agentInteger,
	readAgentId,
	InvalidAgentPayload,
} from '../http-codec.js';
import { AGENT_CAPABILITIES } from '../governance/values.js';
import {
	AGENT_PLUGIN_MAX_DATA_KEY_BYTES,
	AGENT_PLUGIN_MAX_DATA_VALUE_BYTES,
	hasAgentPluginDataValueCapacity,
	AGENT_PLUGIN_STAGE_STATUSES,
	AGENT_PLUGIN_INSTALLATION_STATUSES,
	AGENT_PLUGIN_PACKAGE_INSTALLATION_STATUSES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	AGENT_PLUGIN_MAX_ENTRY_BYTES,
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
	AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	AGENT_PLUGIN_FRONTEND_SANDBOX,
	AGENT_PLUGIN_RPC_TIMEOUT_MS,
	AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
	AGENT_PLUGIN_SDK_VERSION,
	AGENT_PLUGIN_PROTOCOL_VERSION,
	isAgentPluginVersion,
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
	AgentPluginCompatibility,
	AgentPluginPackageReference,
	AgentPluginPackageInstallation,
	AgentPluginAppBinding,
} from './model.js';
import type {
	AgentPluginInstallationListResponse,
	AgentPluginPackageInstallationResponse,
	AgentPluginPackageRetirementRequest,
	AgentPluginPackageInstallationListResponse,
	AgentPluginAppComposeRequest,
	AgentPluginAppCompositionUpdate,
	AgentPluginAppBindingResponse,
	AgentPluginAppBindingListResponse,
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
	const value = agentText(input, AGENT_PLUGIN_PACKAGE_HASH_LENGTH);
	if (!/^[a-f0-9]{64}$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

function version(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_VERSION_BYTES);
	if (!isAgentPluginVersion(value)) {
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

export function readAgentPluginPackageId(input: unknown): string {
	const value = agentText(input, AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value)) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginCompatibility(input: unknown): AgentPluginCompatibility {
	const row = agentRecord(input, ['host', 'backendSdk', 'frontendSdk']);
	const host = agentRecord(row.host, ['minVersion', 'maxVersion']);
	const minVersion = version(host.minVersion),
		maxVersion = version(host.maxVersion);
	if (compare(minVersion, maxVersion) > 0) {
		throw new InvalidAgentPayload();
	}
	return {
		host: { minVersion, maxVersion },
		backendSdk: row.backendSdk === null ? null : agentInteger(row.backendSdk, 1),
		frontendSdk: row.frontendSdk === null ? null : agentInteger(row.frontendSdk, 1),
	};
}

export function readAgentPluginContribution(input: unknown): AgentPluginContribution {
	const row = agentRecord(
		input,
		['app', 'tools', 'services', 'ui', 'settings', 'skills'],
		AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	);
	if (typeof row.tools !== 'boolean' || typeof row.services !== 'boolean' || !Array.isArray(row.skills)) {
		throw new InvalidAgentPayload();
	}
	let app: AgentPluginContribution['app'] = null;
	if (row.app !== null) {
		const value = agentRecord(row.app, ['entry', 'uiContract', 'uiApiVersion']);
		if ((value.uiContract === null) !== (value.uiApiVersion === null)) {
			throw new InvalidAgentPayload();
		}
		app = {
			entry: agentText(value.entry, AGENT_PLUGIN_MAX_ENTRY_BYTES),
			uiContract: value.uiContract === null ? null : pluginContractText(value.uiContract),
			uiApiVersion: value.uiApiVersion === null ? null : agentInteger(value.uiApiVersion, 1),
		};
	}
	let ui: AgentPluginContribution['ui'] = null;
	if (row.ui !== null) {
		const value = agentRecord(row.ui, ['contract', 'apiVersion']);
		ui = { contract: pluginContractText(value.contract), apiVersion: agentInteger(value.apiVersion, 1) };
	}
	let settings: AgentPluginContribution['settings'] = null;
	if (row.settings !== null) {
		const value = agentRecord(
			row.settings,
			['frontendEntry', 'instructions', 'schemaRevision', 'schemaJson', 'defaultsJson', 'agentEditablePaths'],
			AGENT_PLUGIN_MAX_MANIFEST_BYTES,
		);
		if (
			typeof value.schemaJson !== 'string' ||
			typeof value.defaultsJson !== 'string' ||
			typeof value.instructions !== 'string' ||
			!Array.isArray(value.agentEditablePaths)
		) {
			throw new InvalidAgentPayload();
		}
		let parsedSchema: unknown;
		try {
			parsedSchema = JSON.parse(value.schemaJson);
			JSON.parse(value.defaultsJson);
		} catch {
			throw new InvalidAgentPayload();
		}
		if (!isAgentRecord(parsedSchema)) {
			throw new InvalidAgentPayload();
		}
		const paths = value.agentEditablePaths.map((path) => {
			if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path)) {
				throw new InvalidAgentPayload();
			}
			return path;
		});
		if (new Set(paths).size !== paths.length) {
			throw new InvalidAgentPayload();
		}
		settings = {
			frontendEntry: entry(value.frontendEntry, 'frontend'),
			instructions: value.instructions,
			schemaRevision: agentInteger(value.schemaRevision, 1),
			schemaJson: value.schemaJson,
			defaultsJson: value.defaultsJson,
			agentEditablePaths: paths,
		};
	}
	const skills = row.skills.map((item) => {
		const value = agentRecord(item, ['id', 'path']);
		const path = entry(value.path, 'skills');
		if (
			path === null ||
			!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(path) ||
			typeof value.id !== 'string' ||
			value.id.includes('\0')
		) {
			throw new InvalidAgentPayload();
		}
		return { id: value.id, path };
	});
	if (
		new Set(skills.map((skill) => skill.id)).size !== skills.length ||
		(app === null && !row.tools && !row.services && ui === null && settings === null && skills.length === 0)
	) {
		throw new InvalidAgentPayload();
	}
	return { app, tools: row.tools, services: row.services, ui, settings, skills };
}

export function readAgentPluginManifest(input: unknown): AgentPluginManifest {
	const row = agentRecord(
		input,
		[
			'schemaVersion',
			'id',
			'version',
			'displayName',
			...(input !== null && typeof input === 'object' && 'requiredOnEnable' in input ? ['requiredOnEnable'] : []),
			'compatibility',
			'capabilities',
			'intents',
			'frontendEntry',
			'backendEntry',
			'contributions',
			'dependencies',
			'namespaces',
		],
		AGENT_PLUGIN_MAX_MANIFEST_BYTES,
	);
	if (
		row.schemaVersion !== AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION ||
		!Array.isArray(row.capabilities) ||
		!Array.isArray(row.intents) ||
		!Array.isArray(row.dependencies) ||
		!Array.isArray(row.namespaces)
	) {
		throw new InvalidAgentPayload();
	}
	if (row.requiredOnEnable !== undefined && typeof row.requiredOnEnable !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	const id = readAgentPluginPackageId(row.id);
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
	const compatibility = readAgentPluginCompatibility(row.compatibility);
	const frontendEntry = entry(row.frontendEntry, 'frontend'),
		backendEntry = entry(row.backendEntry, 'backend');
	const contributions = readAgentPluginContribution(row.contributions);
	const dependencies = row.dependencies.map((item) => {
		const value = agentRecord(item, ['packageId', 'publisherKeyId', 'minVersion', 'maxVersion']);
		const minVersion = version(value.minVersion),
			maxVersion = version(value.maxVersion);
		if (compare(minVersion, maxVersion) > 0) {
			throw new InvalidAgentPayload();
		}
		return {
			packageId: readAgentPluginPackageId(value.packageId),
			publisherKeyId: keyId(value.publisherKeyId),
			minVersion,
			maxVersion,
		};
	});
	const namespaces = row.namespaces.map(pluginContractText);
	if (
		new Set(capabilities).size !== capabilities.length ||
		new Set(intents.map((item) => item.id)).size !== intents.length ||
		new Set(dependencies.map((item) => item.packageId)).size !== dependencies.length ||
		dependencies.some((dependency) => dependency.packageId === id) ||
		new Set(namespaces).size !== namespaces.length ||
		namespaces.some((namespace) => !/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u.test(namespace)) ||
		(backendEntry === null) !== (compatibility.backendSdk === null) ||
		(frontendEntry !== null || contributions.settings?.frontendEntry != null) !==
			(compatibility.frontendSdk !== null) ||
		(contributions.ui !== null) !== (frontendEntry !== null) ||
		((contributions.app !== null || contributions.tools || contributions.services) &&
			(backendEntry === null || compatibility.backendSdk !== 4 || namespaces.length === 0)) ||
		contributions.skills.some((skill) => skill.id !== id + '.' + skill.path.split('/')[1])
	) {
		throw new InvalidAgentPayload();
	}

	return {
		schemaVersion: AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION,
		id,
		version: version(row.version),
		displayName: agentText(row.displayName, 128),
		requiredOnEnable: row.requiredOnEnable,
		compatibility,
		capabilities,
		intents,
		frontendEntry,
		backendEntry,
		contributions,
		dependencies,
		namespaces,
	};
}

export function readAgentPluginPackageReference(input: unknown): AgentPluginPackageReference {
	const row = agentRecord(input, ['packageId', 'version', 'packageHash', 'publisherKeyId']);
	return {
		packageId: readAgentPluginPackageId(row.packageId),
		version: version(row.version),
		packageHash: hash(row.packageHash),
		publisherKeyId: keyId(row.publisherKeyId),
	};
}

export function readAgentPluginPackageInstallation(input: unknown): AgentPluginPackageInstallation {
	const row = agentRecord(input, [
		'packageId',
		'version',
		'packageHash',
		'publisherKeyId',
		'status',
		'revision',
		'createdAt',
		'updatedAt',
	]);
	const status = AGENT_PLUGIN_PACKAGE_INSTALLATION_STATUSES.find((value) => value === row.status);
	if (!status) {
		throw new InvalidAgentPayload();
	}
	const createdAt = agentInteger(row.createdAt);
	return {
		packageId: readAgentPluginPackageId(row.packageId),
		version: version(row.version),
		packageHash: hash(row.packageHash),
		publisherKeyId: keyId(row.publisherKeyId),
		status,
		revision: agentInteger(row.revision, 1),
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

export function readAgentPluginAppBinding(input: unknown): AgentPluginAppBinding {
	const row = agentRecord(input, [
		'appId',
		'executionRevision',
		'uiRevision',
		'app',
		'dependencies',
		'selectedRootIds',
		'ui',
	]);
	if (!Array.isArray(row.dependencies) || !Array.isArray(row.selectedRootIds)) {
		throw new InvalidAgentPayload();
	}
	const dependencies = row.dependencies.map(readAgentPluginPackageReference);
	const selectedRootIds = row.selectedRootIds.map(readAgentPluginPackageId);
	const app = readAgentPluginPackageReference(row.app);
	const ui = row.ui === null ? null : readAgentPluginPackageReference(row.ui);
	const identities = new Map<string, AgentPluginPackageReference>();
	for (const reference of [app, ...dependencies, ...(ui === null ? [] : [ui])]) {
		const previous = identities.get(reference.packageId);
		if (
			previous &&
			(previous.version !== reference.version ||
				previous.packageHash !== reference.packageHash ||
				previous.publisherKeyId !== reference.publisherKeyId)
		) {
			throw new InvalidAgentPayload();
		}
		identities.set(reference.packageId, reference);
	}
	if (
		new Set(dependencies.map((item) => item.packageId)).size !== dependencies.length ||
		dependencies.some((item) => item.packageId === app.packageId) ||
		new Set(selectedRootIds).size !== selectedRootIds.length ||
		selectedRootIds.some((id) => !dependencies.some((item) => item.packageId === id))
	) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: readAgentId(row.appId),
		executionRevision: agentInteger(row.executionRevision, 1),
		uiRevision: agentInteger(row.uiRevision, 1),
		app,
		dependencies,
		selectedRootIds,
		ui,
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
		'purpose',
		'instanceId',
		'appId',
		'version',
		'url',
		'sdkVersion',
		'protocolVersion',
		'package',
		'uiRevision',
		'sandbox',
		'maxMessageBytes',
		'requestTimeoutMs',
		'expiresAt',
	]);
	if (
		(row.purpose !== 'app' && row.purpose !== 'settings') ||
		row.sdkVersion !== AGENT_PLUGIN_SDK_VERSION ||
		row.protocolVersion !== AGENT_PLUGIN_PROTOCOL_VERSION ||
		row.sandbox !== AGENT_PLUGIN_FRONTEND_SANDBOX
	) {
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
	const packageReference = readAgentPluginPackageReference(row.package);
	if (packageReference.version !== release) {
		throw new InvalidAgentPayload();
	}
	const parts = url.slice(('/plugins/' + appId + '/' + release + '/').length).split('/');
	readAgentId(parts[0]);
	entry(parts.slice(1).join('/'), 'frontend');
	return {
		purpose: row.purpose,
		instanceId: readAgentId(row.instanceId),
		appId,
		version: release,
		url,
		sdkVersion: AGENT_PLUGIN_SDK_VERSION,
		protocolVersion: AGENT_PLUGIN_PROTOCOL_VERSION,
		package: packageReference,
		uiRevision: agentInteger(row.uiRevision, 1),
		sandbox: AGENT_PLUGIN_FRONTEND_SANDBOX,
		maxMessageBytes: agentInteger(row.maxMessageBytes, 1, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES),
		requestTimeoutMs: agentInteger(row.requestTimeoutMs, 1, AGENT_PLUGIN_RPC_TIMEOUT_MS),
		expiresAt: agentInteger(row.expiresAt, 1),
	};
}

export function readAgentPluginItems<T>(input: unknown, read: (value: unknown) => T): { items: T[] } {
	const row = agentRecord(input, ['items'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items)) {
		throw new InvalidAgentPayload();
	}
	return { items: row.items.map(read) };
}

export function readAgentPluginInstallationList(input: unknown): AgentPluginInstallationListResponse {
	const row = agentRecord(input, ['items', 'retainedAppIds'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || !Array.isArray(row.retainedAppIds)) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentPluginInstallation);
	const retainedAppIds = row.retainedAppIds.map(readAgentId);
	const removedIds = new Set(items.filter((item) => item.status === 'removed').map((item) => item.appId));
	if (
		new Set(items.map((item) => item.appId)).size !== items.length ||
		new Set(retainedAppIds).size !== retainedAppIds.length ||
		retainedAppIds.some((id) => !removedIds.has(id))
	) {
		throw new InvalidAgentPayload();
	}
	return { items, retainedAppIds };
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
	if (!hasAgentPluginDataValueCapacity(value)) {
		throw new InvalidAgentPayload();
	}
	try {
		JSON.parse(value);
	} catch {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentPluginAppCompose(input: unknown): AgentPluginAppComposeRequest {
	const row = agentRecord(input, ['packageId', 'selectedRootIds', 'uiPackageId']);
	if (!Array.isArray(row.selectedRootIds)) {
		throw new InvalidAgentPayload();
	}
	const packageId = readAgentPluginPackageId(row.packageId);
	const selectedRootIds = row.selectedRootIds.map(readAgentPluginPackageId);
	if (new Set(selectedRootIds).size !== selectedRootIds.length || selectedRootIds.includes(packageId)) {
		throw new InvalidAgentPayload();
	}
	return {
		packageId,
		selectedRootIds,
		uiPackageId: row.uiPackageId === null ? null : readAgentPluginPackageId(row.uiPackageId),
	};
}

export function readAgentPluginAppCompositionUpdate(input: unknown): AgentPluginAppCompositionUpdate {
	const row = agentRecord(input, [
		'packageId',
		'selectedRootIds',
		'uiPackageId',
		'expectedExecutionRevision',
		'expectedUiRevision',
	]);
	const composition = readAgentPluginAppCompose({
		packageId: row.packageId,
		selectedRootIds: row.selectedRootIds,
		uiPackageId: row.uiPackageId,
	});
	return {
		packageId: composition.packageId,
		selectedRootIds: composition.selectedRootIds.map((id) => id),
		uiPackageId: composition.uiPackageId,
		expectedExecutionRevision: agentInteger(row.expectedExecutionRevision, 1),
		expectedUiRevision: agentInteger(row.expectedUiRevision, 1),
	};
}

export function readAgentPluginPackageInstallationResponse(input: unknown): AgentPluginPackageInstallationResponse {
	const row = agentRecord(input, ['installation']);
	return { installation: readAgentPluginPackageInstallation(row.installation) };
}

export function readAgentPluginPackageInstallationList(input: unknown): AgentPluginPackageInstallationListResponse {
	const row = agentRecord(input, ['installations', 'retainedPackageIds'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.installations) || !Array.isArray(row.retainedPackageIds)) {
		throw new InvalidAgentPayload();
	}
	const installations = row.installations.map(readAgentPluginPackageInstallation);
	const retainedPackageIds = row.retainedPackageIds.map(readAgentPluginPackageId);
	const removedIds = new Set(installations.filter((item) => item.status === 'removed').map((item) => item.packageId));
	if (
		new Set(installations.map((item) => item.packageId)).size !== installations.length ||
		new Set(retainedPackageIds).size !== retainedPackageIds.length ||
		retainedPackageIds.some((id) => !removedIds.has(id))
	) {
		throw new InvalidAgentPayload();
	}
	return { installations, retainedPackageIds };
}

export function readAgentPluginAppBindingResponse(input: unknown): AgentPluginAppBindingResponse {
	const row = agentRecord(input, ['binding']);
	return { binding: readAgentPluginAppBinding(row.binding) };
}

export function readAgentPluginAppBindingList(input: unknown): AgentPluginAppBindingListResponse {
	const row = agentRecord(input, ['bindings'], AGENT_PLUGIN_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.bindings)) {
		throw new InvalidAgentPayload();
	}
	const bindings = row.bindings.map(readAgentPluginAppBinding);
	if (new Set(bindings.map((item) => item.appId)).size !== bindings.length) {
		throw new InvalidAgentPayload();
	}
	return { bindings };
}

export function readAgentPluginPackageRetirement(input: unknown): AgentPluginPackageRetirementRequest {
	const row = agentRecord(input, ['expectedRevision', 'clearData']);
	if (typeof row.clearData !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return { expectedRevision: agentInteger(row.expectedRevision, 1), clearData: row.clearData };
}

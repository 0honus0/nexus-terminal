import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';
import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredPluginManifest } from '../../storage/plugin-storage.js';
import { AGENT_PLUGIN_MAX_ENTRY_BYTES } from '@nexus-terminal/shared/agent/plugins/values';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
		throw new Error('Invalid plugin manifest');
	}
	return value;
}

function text(value: unknown, maxBytes: number): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		Buffer.byteLength(value, 'utf8') > maxBytes ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new Error('Invalid plugin manifest text');
	}
	return value;
}

export function pluginEntry(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	const path = text(value, AGENT_PLUGIN_MAX_ENTRY_BYTES);
	if (
		path.startsWith('/') ||
		path.includes('\\') ||
		path.split('/').some((part) => part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
	) {
		throw new Error('Invalid plugin entry');
	}
	return path;
}

/** Decode the latest persisted manifest and signed manifest in one owner; no historical shape bridge. */
export function pluginManifest(value: unknown): StoredPluginManifest {
	const row = record(value, [
		'schemaVersion',
		'id',
		'version',
		'displayName',
		'sdkVersion',
		'capabilities',
		'intents',
		'frontendEntry',
		'backendEntry',
	]);
	if (
		row.schemaVersion !== 1 ||
		row.sdkVersion !== '1' ||
		!Array.isArray(row.capabilities) ||
		row.capabilities.length > AGENT_CAPABILITIES.length ||
		!Array.isArray(row.intents) ||
		row.intents.length > 128
	) {
		throw new Error('Invalid plugin manifest shape');
	}
	const id = text(row.id, 128),
		version = text(row.version, 64);
	if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(id) || !isAgentPluginVersion(version)) {
		throw new Error('Invalid plugin identity');
	}
	const capabilities: AgentCapability[] = row.capabilities.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (!capability) {
			throw new Error('Invalid plugin capability');
		}
		return capability;
	});
	if (new Set(capabilities).size !== capabilities.length) {
		throw new Error('Duplicate plugin capability');
	}
	const intents = row.intents.map((value) => {
		const item = record(value, ['id', 'schemaVersion']);
		if (
			typeof item.schemaVersion !== 'number' ||
			!Number.isSafeInteger(item.schemaVersion) ||
			item.schemaVersion < 1
		) {
			throw new Error('Invalid plugin intent version');
		}
		return { id: text(item.id, 128), schemaVersion: item.schemaVersion };
	});
	if (new Set(intents.map((item) => item.id)).size !== intents.length) {
		throw new Error('Duplicate plugin intent');
	}
	const frontendEntry = pluginEntry(row.frontendEntry),
		backendEntry = pluginEntry(row.backendEntry);
	if (
		(frontendEntry !== null && !frontendEntry.startsWith('frontend/')) ||
		(backendEntry !== null && !backendEntry.startsWith('backend/'))
	) {
		throw new Error('Invalid plugin entry namespace');
	}
	return {
		schemaVersion: 1,
		id,
		version,
		displayName: text(row.displayName, 128),
		sdkVersion: '1',
		capabilities,
		intents,
		frontendEntry,
		backendEntry,
	};
}

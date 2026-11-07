import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';
import type { StoredLegacyPluginSummary } from '../../storage/plugin-legacy-storage.js';

export function legacyPluginSummary(value: unknown): StoredLegacyPluginSummary {
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('format' in value) ||
		value.format !== 'legacy-archive' ||
		!('packageId' in value) ||
		typeof value.packageId !== 'string' ||
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value.packageId) ||
		!('version' in value) ||
		typeof value.version !== 'string' ||
		!isAgentPluginVersion(value.version) ||
		!('displayName' in value) ||
		typeof value.displayName !== 'string' ||
		!value.displayName.trim() ||
		!('capabilities' in value) ||
		!Array.isArray(value.capabilities) ||
		Object.keys(value).length !== 5
	) {
		throw new Error('Corrupt archived plugin summary');
	}
	const capabilities = value.capabilities.map((value) => {
		const capability = AGENT_CAPABILITIES.find((item) => item === value);
		if (!capability) {
			throw new Error('Corrupt archived plugin capability');
		}
		return capability;
	});
	if (new Set(capabilities).size !== capabilities.length) {
		throw new Error('Duplicate archived plugin capability');
	}
	return {
		format: 'legacy-archive',
		packageId: value.packageId,
		version: value.version,
		displayName: value.displayName,
		capabilities,
	};
}

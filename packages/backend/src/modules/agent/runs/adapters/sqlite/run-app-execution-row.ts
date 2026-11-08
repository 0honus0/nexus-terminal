import type { StoredRunAppExecution } from '../../storage/run-storage.js';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';
import {
	AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES,
	AGENT_PLUGIN_MAX_VERSION_BYTES,
} from '@nexus-terminal/shared/agent/plugins/package-values';

export function readRunAppPackage(value: unknown) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== 4 ||
		!('packageId' in value) ||
		typeof value.packageId !== 'string' ||
		Buffer.byteLength(value.packageId, 'utf8') > AGENT_PLUGIN_MAX_PACKAGE_ID_BYTES ||
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(value.packageId) ||
		!('version' in value) ||
		typeof value.version !== 'string' ||
		Buffer.byteLength(value.version, 'utf8') > AGENT_PLUGIN_MAX_VERSION_BYTES ||
		!isAgentPluginVersion(value.version) ||
		!('packageHash' in value) ||
		typeof value.packageHash !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.packageHash) ||
		!('publisherKeyId' in value) ||
		typeof value.publisherKeyId !== 'string' ||
		!/^ed25519:[a-f0-9]{64}$/u.test(value.publisherKeyId)
	) {
		throw new Error('Corrupt frozen root App package');
	}
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

/** Only the current plugin execution representation is accepted. */
export function readRunAppExecution(json: unknown): StoredRunAppExecution {
	if (typeof json !== 'string') {
		throw new Error('Corrupt frozen App execution');
	}
	const value: unknown = JSON.parse(json);
	if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
		throw new Error('Corrupt frozen App execution');
	}
	if (
		value.kind !== 'plugin' ||
		Object.keys(value).length !== 4 ||
		!('package' in value) ||
		!('codeDependencies' in value) ||
		!Array.isArray(value.codeDependencies) ||
		!('handler' in value) ||
		typeof value.handler !== 'string' ||
		!value.handler.trim() ||
		value.handler.includes('\0')
	) {
		throw new Error('Corrupt frozen App execution');
	}
	const codeDependencies = value.codeDependencies.map(readRunAppPackage);
	if (new Set(codeDependencies.map((dependency) => dependency.packageId)).size !== codeDependencies.length) {
		throw new Error('Duplicate App code dependency');
	}
	return { kind: 'plugin', package: readRunAppPackage(value.package), codeDependencies, handler: value.handler };
}

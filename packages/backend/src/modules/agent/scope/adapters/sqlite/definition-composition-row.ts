import { createHash } from 'node:crypto';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredPluginScopePackage } from '../../storage/plugin-scope-storage.js';
import { isAgentPluginVersion } from '@nexus-terminal/shared/agent/plugins/values';

export function readDefinitionPackage(row: SqlRow): StoredPluginScopePackage {
	if (
		typeof row.package_id !== 'string' ||
		!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(row.package_id) ||
		Buffer.byteLength(row.package_id, 'utf8') > 128 ||
		(row.kind !== 'app' && row.kind !== 'tool') ||
		typeof row.version !== 'string' ||
		!isAgentPluginVersion(row.version) ||
		typeof row.package_hash !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(row.package_hash) ||
		typeof row.publisher_key_id !== 'string' ||
		!/^ed25519:[a-f0-9]{64}$/u.test(row.publisher_key_id)
	) {
		throw new Error('Corrupt execution declaration package');
	}
	return {
		packageId: row.package_id,
		kind: row.kind,
		version: row.version,
		packageHash: row.package_hash,
		publisherKeyId: row.publisher_key_id,
	};
}

/** Scope identity is an opaque digest of the exact user and execution packages, never a package version. */
export function definitionComposition(
	userId: number,
	references: readonly StoredPluginScopePackage[],
): { id: string; digest: string; packages: StoredPluginScopePackage[] } {
	if (!Number.isSafeInteger(userId) || userId < 1) {
		throw new Error('Corrupt declaration owner');
	}
	const packages = references
		.map((value) =>
			readDefinitionPackage({
				package_id: value.packageId,
				kind: value.kind,
				version: value.version,
				package_hash: value.packageHash,
				publisher_key_id: value.publisherKeyId,
			}),
		)
		.sort((left, right) => {
			const a = left.kind + ':' + left.packageId,
				b = right.kind + ':' + right.packageId;
			return a < b ? -1 : a > b ? 1 : 0;
		});
	const identities = new Set(packages.map((value) => JSON.stringify([value.kind, value.packageId])));
	if (packages.filter((value) => value.kind === 'app').length !== 1 || identities.size !== packages.length) {
		throw new Error('Corrupt execution declaration composition');
	}
	const packageVersions = new Map<string, string>();
	for (const reference of packages) {
		const identity = JSON.stringify([reference.version, reference.packageHash, reference.publisherKeyId]);
		const previous = packageVersions.get(reference.packageId);
		if (previous !== undefined && previous !== identity) {
			throw new Error('Conflicting execution package roles');
		}
		packageVersions.set(reference.packageId, identity);
	}
	const digest = createHash('sha256').update(JSON.stringify({ userId, packages })).digest('hex');
	return { id: 'composition.c' + digest, digest, packages };
}

import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';

function definitionKey(id: unknown, version: unknown): string {
	if (typeof id !== 'string' || typeof version !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	return JSON.stringify([id, version]);
}

/** Scope declarations must match the verified plugin package facts in the same snapshot. */
export function validateSnapshotDeclarations(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const declarations = rows.get('agent_app_definitions') ?? [];
	const capabilities = rows.get('agent_app_declared_capabilities') ?? [];
	const versions = rows.get('agent_plugin_versions') ?? [];
	const versionIndex = new Map(versions.map((row) => [definitionKey(row.definition_id, row.version), row]));
	const capabilityIndex = new Map<string, string[]>();
	for (const row of capabilities) {
		if (typeof row.capability !== 'string') {
			throw new SnapshotFailure('unavailable');
		}
		const key = definitionKey(row.definition_id, row.definition_version);
		const declared = capabilityIndex.get(key) ?? [];
		declared.push(row.capability);
		capabilityIndex.set(key, declared);
	}
	for (const row of declarations) {
		const key = definitionKey(row.id, row.version);
		const version = versionIndex.get(key);
		if (!version || typeof version.manifest_json !== 'string' || row.content_hash !== version.package_hash) {
			throw new SnapshotFailure('unavailable');
		}
		const manifest = pluginManifest(JSON.parse(version.manifest_json));
		if (
			row.id !== manifest.id ||
			row.version !== manifest.version ||
			row.display_name !== manifest.displayName ||
			JSON.stringify((capabilityIndex.get(key) ?? []).sort()) !==
				JSON.stringify([...manifest.capabilities].sort())
		) {
			throw new SnapshotFailure('unavailable');
		}
	}
}

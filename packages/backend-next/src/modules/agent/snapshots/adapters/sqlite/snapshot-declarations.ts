import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import type { StoredDefinition } from '../../../scope/storage/scope-storage.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';

function definitionKey(id: unknown, version: unknown): string {
	if (typeof id !== 'string' || typeof version !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	return JSON.stringify([id, version]);
}

/** Snapshot declarations cannot manufacture builtin authority or diverge from signed plugin content. */
export function validateSnapshotDeclarations(
	rows: ReadonlyMap<string, readonly SqlRow[]>,
	trusted: readonly StoredDefinition[],
): void {
	const declarations = rows.get('agent_app_definitions') ?? [];
	const capabilities = rows.get('agent_app_declared_capabilities') ?? [];
	const versions = rows.get('agent_plugin_versions') ?? [];
	const versionIndex = new Map(versions.map((row) => [definitionKey(row.definition_id, row.version), row]));
	const trustedIndex = new Map(
		trusted.map((definition) => [definitionKey(definition.id, definition.version), definition]),
	);
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
	const installed = new Set<string>();
	for (const row of declarations) {
		const key = definitionKey(row.id, row.version);
		const declared = (capabilityIndex.get(key) ?? []).sort();
		if (row.source_kind === 'builtin') {
			if (row.installed !== 1) {
				continue;
			}
			const definition = trustedIndex.get(key);
			if (
				!definition ||
				row.content_hash !== definition.contentHash ||
				row.display_name !== definition.displayName ||
				row.default_enabled !== Number(definition.defaultEnabled) ||
				JSON.stringify(declared) !== JSON.stringify([...definition.capabilities].sort())
			) {
				throw new SnapshotFailure('unavailable');
			}
			installed.add(definition.id);
		} else if (row.source_kind === 'plugin') {
			const version = versionIndex.get(key);
			if (
				!version ||
				typeof version.manifest_json !== 'string' ||
				row.content_hash !== version.package_hash ||
				row.default_enabled !== 0
			) {
				throw new SnapshotFailure('unavailable');
			}
			const manifest = pluginManifest(JSON.parse(version.manifest_json));
			if (
				row.display_name !== manifest.displayName ||
				JSON.stringify(declared) !== JSON.stringify([...manifest.capabilities].sort())
			) {
				throw new SnapshotFailure('unavailable');
			}
		} else {
			throw new SnapshotFailure('unavailable');
		}
	}
	if (installed.size !== trusted.length) {
		throw new SnapshotFailure('unavailable');
	}
}

import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import {
	definitionComposition,
	readDefinitionPackage,
} from '../../../scope/adapters/sqlite/definition-composition-row.js';
import { snapshotVersionKey, snapshotPluginVersion } from './snapshot-plugin-versions.js';
import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';

function definitionKey(id: unknown, version: unknown): string {
	if (typeof id !== 'string' || typeof version !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	return JSON.stringify([id, version]);
}

/** Every historical declaration is proved by its retained exact package ledger, not current dependencies. */
export function validateSnapshotDeclarations(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const versions = new Map((rows.get('agent_plugin_versions') ?? []).map((row) => [snapshotVersionKey(row), row]));
	const archives = new Map(
		(rows.get('agent_plugin_legacy_versions') ?? []).map((row) => [snapshotVersionKey(row), row]),
	);
	const packages = new Map<string, SqlRow[]>();
	for (const row of rows.get('agent_app_definition_packages') ?? []) {
		readDefinitionPackage(row);
		const key = definitionKey(row.definition_id, row.definition_version);
		const group = packages.get(key) ?? [];
		group.push(row);
		packages.set(key, group);
	}
	const capabilities = new Map<string, string[]>();
	for (const row of rows.get('agent_app_declared_capabilities') ?? []) {
		const value = AGENT_CAPABILITIES.find((capability) => capability === row.capability);
		if (value === undefined) {
			throw new SnapshotFailure('unavailable');
		}
		const key = definitionKey(row.definition_id, row.definition_version),
			group = capabilities.get(key) ?? [];
		if (group.includes(value)) {
			throw new SnapshotFailure('unavailable');
		}
		group.push(value);
		capabilities.set(key, group);
	}
	const declarations = new Map<string, { row: SqlRow; userId: number; references: SqlRow[] }>();
	for (const row of rows.get('agent_app_definitions') ?? []) {
		const key = definitionKey(row.id, row.version),
			references = packages.get(key) ?? [];
		const owner = references[0]?.user_id;
		if (
			declarations.has(key) ||
			typeof owner !== 'number' ||
			references.some((reference) => reference.user_id !== owner)
		) {
			throw new SnapshotFailure('unavailable');
		}
		const composition = definitionComposition(owner, references.map(readDefinitionPackage));
		if (composition.id !== row.id || composition.digest !== row.content_hash) {
			throw new SnapshotFailure('unavailable');
		}
		const declared = new Set<string>();
		for (const reference of references) {
			const version = versions.get(JSON.stringify([owner, reference.package_id, reference.version]));
			if (
				!version ||
				version.package_hash !== reference.package_hash ||
				version.publisher_key_id !== reference.publisher_key_id
			) {
				throw new SnapshotFailure('unavailable');
			}
			const facts = snapshotPluginVersion(version, archives.get(snapshotVersionKey(version)));
			if (
				reference.kind === 'app' &&
				(facts.summary.version !== row.version ||
					facts.summary.displayName !== row.display_name ||
					!facts.kinds.app)
			) {
				throw new SnapshotFailure('unavailable');
			}
			if (reference.kind === 'tool' && !facts.kinds.tool) {
				throw new SnapshotFailure('unavailable');
			}
			for (const capability of facts.summary.capabilities) {
				declared.add(capability);
			}
		}
		if (JSON.stringify((capabilities.get(key) ?? []).sort()) !== JSON.stringify([...declared].sort())) {
			throw new SnapshotFailure('unavailable');
		}
		declarations.set(key, { row, userId: owner, references });
	}
	for (const key of packages.keys()) {
		if (!declarations.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
	}
	for (const key of capabilities.keys()) {
		if (!declarations.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
	}
	const bound = new Map<string, SqlRow[]>();
	for (const reference of rows.get('agent_plugin_app_packages') ?? []) {
		if (reference.kind !== 'app' && reference.kind !== 'tool') {
			continue;
		}
		const key = JSON.stringify([reference.user_id, reference.app_id]),
			group = bound.get(key) ?? [];
		group.push(reference);
		bound.set(key, group);
	}
	for (const app of rows.get('agent_apps') ?? []) {
		const declaration = declarations.get(definitionKey(app.definition_id, app.definition_version));
		if (!declaration || declaration.userId !== app.user_id) {
			throw new SnapshotFailure('unavailable');
		}
		const current = bound.get(JSON.stringify([app.user_id, app.id])) ?? [];
		const currentComposition = definitionComposition(declaration.userId, current.map(readDefinitionPackage));
		if (currentComposition.id !== app.definition_id || currentComposition.digest !== declaration.row.content_hash) {
			throw new SnapshotFailure('unavailable');
		}
	}
}

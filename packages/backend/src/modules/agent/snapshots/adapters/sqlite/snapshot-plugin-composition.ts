import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { packageInstallation, packageReference } from '../../../plugins/adapters/sqlite/plugin-composition-sql.js';
import { pluginInstallationRow } from '../../../plugins/adapters/sqlite/plugin-installation-row.js';
import { pluginRuntimeRow } from '../../../plugins/adapters/sqlite/plugin-runtime-row.js';
import { stageRow } from '../../../plugins/adapters/sqlite/plugin-row.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { snapshotVersionKey, snapshotPluginVersion } from './snapshot-plugin-versions.js';
import { snapshotLegacyManifest } from './snapshot-legacy-package.js';
import { matchesAppExecutionDependency } from '../../../plugins/plugin-app-execution-rules.js';

function scope(row: SqlRow): string {
	if (
		typeof row.user_id !== 'number' ||
		!Number.isSafeInteger(row.user_id) ||
		row.user_id < 1 ||
		typeof row.app_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.app_id)
	) {
		throw new SnapshotFailure('unavailable');
	}
	return JSON.stringify([row.user_id, row.app_id]);
}

function positive(value: unknown): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new SnapshotFailure('unavailable');
	}
}

export function validateSnapshotPluginComposition(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const versions = new Map((rows.get('agent_plugin_versions') ?? []).map((row) => [snapshotVersionKey(row), row]));
	const archives = new Map(
		(rows.get('agent_plugin_legacy_versions') ?? []).map((row) => [snapshotVersionKey(row), row]),
	);
	const packages = new Map<string, SqlRow>();

	const packageKey = (row: SqlRow) => JSON.stringify([row.user_id, row.package_id]);

	const versionFor = (row: SqlRow) => {
		const reference = packageReference(row);
		const version = versions.get(JSON.stringify([row.user_id, reference.packageId, reference.version]));
		if (
			!version ||
			version.package_hash !== reference.packageHash ||
			version.publisher_key_id !== reference.publisherKeyId
		) {
			throw new SnapshotFailure('unavailable');
		}
		return snapshotPluginVersion(version, archives.get(snapshotVersionKey(version)));
	};

	for (const row of rows.get('agent_plugin_packages') ?? []) {
		packageInstallation(row);
		const key = packageKey(row);
		if (packages.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
		versionFor(row);
		packages.set(key, row);
	}
	const apps = new Map((rows.get('agent_apps') ?? []).map((row) => [JSON.stringify([row.user_id, row.id]), row]));
	const installations = new Map<string, SqlRow>();
	for (const row of rows.get('agent_plugin_installations') ?? []) {
		pluginInstallationRow(row);
		const key = scope(row);
		if (installations.has(key) || !apps.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
		const version = versions.get(snapshotVersionKey(row));
		if (
			!version ||
			version.package_hash !== row.package_hash ||
			version.publisher_key_id !== row.publisher_key_id ||
			!packages.has(JSON.stringify([row.user_id, row.definition_id]))
		) {
			throw new SnapshotFailure('unavailable');
		}
		installations.set(key, row);
	}
	const references = new Map<string, SqlRow[]>();
	const referenceIds = new Set<string>();
	for (const row of rows.get('agent_plugin_app_packages') ?? []) {
		const key = scope(row);
		const identity = JSON.stringify([key, row.package_id, row.kind]);
		const installation = installations.get(key);
		const installed = packages.get(packageKey(row));
		if (
			!installation ||
			!installed ||
			referenceIds.has(identity) ||
			(row.kind !== 'app' && row.kind !== 'tool' && row.kind !== 'ui')
		) {
			throw new SnapshotFailure('unavailable');
		}
		referenceIds.add(identity);
		const version = versionFor(row);
		if (
			installation.status !== 'removed' &&
			(installed.version !== row.version ||
				installed.package_hash !== row.package_hash ||
				installed.publisher_key_id !== row.publisher_key_id ||
				(installed.status !== 'installed' && installed.status !== 'draining') ||
				version.manifest === null)
		) {
			throw new SnapshotFailure('unavailable');
		}
		if (!(row.kind === 'app' ? version.kinds.app : row.kind === 'tool' ? version.kinds.tool : version.kinds.ui)) {
			throw new SnapshotFailure('unavailable');
		}
		const group = references.get(key) ?? [];
		group.push(row);
		references.set(key, group);
	}
	const bindings = new Set<string>();
	for (const row of rows.get('agent_plugin_app_bindings') ?? []) {
		const key = scope(row);
		positive(row.execution_revision);
		positive(row.ui_revision);
		const installation = installations.get(key);
		const group = references.get(key) ?? [];
		const main = group.filter((reference) => reference.kind === 'app');
		if (
			!installation ||
			bindings.has(key) ||
			main.length !== 1 ||
			group.filter((reference) => reference.kind === 'ui').length > 1
		) {
			throw new SnapshotFailure('unavailable');
		}
		const app = main[0];
		if (
			!app ||
			app.package_id !== installation.definition_id ||
			app.version !== installation.version ||
			app.package_hash !== installation.package_hash ||
			app.publisher_key_id !== installation.publisher_key_id
		) {
			throw new SnapshotFailure('unavailable');
		}
		if (installation.status !== 'removed') {
			const manifest = versionFor(app).manifest;
			const contribution = manifest?.contributions.app;
			if (!manifest || !contribution) {
				throw new SnapshotFailure('unavailable');
			}
			if (
				manifest.backendEntry === null ||
				manifest.compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)
			) {
				throw new SnapshotFailure('unavailable');
			}
			const selected = new Map(group.map((reference) => [reference.package_id, reference]));
			const pending = group.filter(
				(reference) => reference.kind === 'app' || reference.kind === 'ui' || reference.selected_root === 1,
			);
			const visited = new Set<unknown>();
			while (pending.length) {
				const reference = pending.pop();
				if (!reference || visited.has(reference.package_id)) {
					continue;
				}
				visited.add(reference.package_id);
				const selectedManifest = versionFor(reference).manifest;
				if (!selectedManifest) {
					throw new SnapshotFailure('unavailable');
				}
				for (const dependency of selectedManifest.dependencies) {
					const provider = selected.get(dependency.packageId);
					if (!provider || !matchesAppExecutionDependency(dependency, packageReference(provider))) {
						throw new SnapshotFailure('unavailable');
					}
					pending.push(provider);
				}
			}
			if (visited.size !== selected.size) {
				throw new SnapshotFailure('unavailable');
			}
			const uiReference = group.find((reference) => reference.kind === 'ui');
			if (uiReference) {
				const ui = versionFor(uiReference).manifest?.contributions.ui;
				if (!ui || ui.contract !== contribution.uiContract || ui.apiVersion !== contribution.uiApiVersion) {
					throw new SnapshotFailure('unavailable');
				}
			}
		}
		bindings.add(key);
	}
	for (const key of installations.keys()) {
		if (!bindings.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
	}
	for (const key of references.keys()) {
		if (!bindings.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
	}
	const instances = new Set<string>();
	const runtimeScopes = new Set<string>();
	for (const table of ['agent_plugin_runtime_instances', 'agent_plugin_runtime_history']) {
		for (const row of rows.get(table) ?? []) {
			const observation = pluginRuntimeRow(row);
			const key = scope(row);
			const packageId = row.package_id;
			if (
				!installations.has(key) ||
				typeof packageId !== 'string' ||
				!packages.has(packageKey(row)) ||
				instances.has(observation.instanceId)
			) {
				throw new SnapshotFailure('unavailable');
			}
			instances.add(observation.instanceId);
			if (table === 'agent_plugin_runtime_instances') {
				const identity = JSON.stringify([key, row.logical_instance_id]);
				if (runtimeScopes.has(identity)) {
					throw new SnapshotFailure('unavailable');
				}
				runtimeScopes.add(identity);
			}
		}
	}
	const stages = new Map((rows.get('agent_plugin_stages') ?? []).map((row) => [row.id, row]));
	const updates = new Set<string>();
	for (const row of rows.get('agent_plugin_package_updates') ?? []) {
		const key = packageKey(row),
			installation = packages.get(key),
			raw = stages.get(row.stage_id);
		positive(row.stage_version);
		if (
			!installation ||
			!raw ||
			updates.has(key) ||
			raw.user_id !== row.user_id ||
			(row.data_migrated !== 0 && row.data_migrated !== 1) ||
			typeof row.created_at !== 'number' ||
			!Number.isSafeInteger(row.created_at) ||
			row.created_at < 0
		) {
			throw new SnapshotFailure('unavailable');
		}
		const candidate = stageRow(raw);
		const quarantined =
			installation.status === 'incompatible' && row.data_migrated === 1 && candidate.status === 'failed';
		if (quarantined) {
			if (
				typeof raw.manifest_json !== 'string' ||
				typeof raw.publisher_key_id !== 'string' ||
				candidate.version < Number(row.stage_version)
			) {
				throw new SnapshotFailure('unavailable');
			}
			const original = snapshotLegacyManifest(JSON.parse(raw.manifest_json));
			if (
				(original.schemaVersion !== 2 && original.schemaVersion !== 3) ||
				original.summary.packageId !== row.package_id
			) {
				throw new SnapshotFailure('unavailable');
			}
			updates.add(key);
			continue;
		}
		if (
			(candidate.status !== 'verified' && candidate.status !== 'installed') ||
			candidate.version < Number(row.stage_version) ||
			candidate.manifest?.id !== row.package_id
		) {
			throw new SnapshotFailure('unavailable');
		}
		updates.add(key);
	}
}

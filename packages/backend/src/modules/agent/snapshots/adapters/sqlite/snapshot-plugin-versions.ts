import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { stageRow, publisherRow } from '../../../plugins/adapters/sqlite/plugin-row.js';
import { packageReference } from '../../../plugins/adapters/sqlite/plugin-composition-sql.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';
import { legacyPluginSummary } from '../../../plugins/adapters/sqlite/plugin-legacy-row.js';
import { snapshotLegacyManifest } from './snapshot-legacy-package.js';

export function snapshotVersionKey(row: SqlRow): string {
	if (typeof row.user_id !== 'number' || !Number.isSafeInteger(row.user_id) || row.user_id < 1) {
		throw new SnapshotFailure('unavailable');
	}
	const reference = packageReference({
		package_id: row.definition_id,
		version: row.version,
		package_hash: row.package_hash,
		publisher_key_id: row.publisher_key_id,
	});
	return JSON.stringify([row.user_id, reference.packageId, reference.version]);
}

/** Current executable manifests and explicitly inert historical summaries stay separate. */
export function snapshotPluginVersion(row: SqlRow, archived?: SqlRow) {
	snapshotVersionKey(row);
	if (typeof row.manifest_json !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	const input: unknown = JSON.parse(row.manifest_json);
	if (input !== null && typeof input === 'object' && 'format' in input && input.format === 'legacy-archive') {
		const summary = legacyPluginSummary(input);
		if (summary.packageId !== row.definition_id || summary.version !== row.version) {
			throw new SnapshotFailure('unavailable');
		}
		if (
			archived &&
			(snapshotVersionKey(archived) !== snapshotVersionKey(row) ||
				archived.package_hash !== row.package_hash ||
				archived.publisher_key_id !== row.publisher_key_id ||
				archived.stage_id !== row.stage_id)
		) {
			throw new SnapshotFailure('unavailable');
		}
		const original =
			archived && typeof archived.manifest_json === 'string'
				? snapshotLegacyManifest(JSON.parse(archived.manifest_json))
				: null;
		if (original && JSON.stringify(original.summary) !== JSON.stringify(summary)) {
			throw new SnapshotFailure('unavailable');
		}
		return {
			summary,
			manifest: null,
			kinds: original?.kinds ?? { app: true, tool: false, ui: false },
			toolNames: original?.toolNames ?? [],
		};
	}
	const manifest = pluginManifest(input);
	const toolNames: string[] = [];
	if (manifest.id !== row.definition_id || manifest.version !== row.version) {
		throw new SnapshotFailure('unavailable');
	}
	return {
		summary: {
			packageId: manifest.id,
			version: manifest.version,
			displayName: manifest.displayName,
			capabilities: manifest.capabilities.map((value) => value),
		},
		manifest,
		kinds: {
			app: manifest.contributions.app !== null,
			tool:
				manifest.contributions.tools ||
				manifest.contributions.skills.length > 0 ||
				manifest.backendEntry !== null,
			ui: manifest.contributions.ui !== null,
		},
		toolNames,
	};
}

export function validateSnapshotPluginVersions(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const stages = new Map<unknown, SqlRow>();
	for (const row of rows.get('agent_plugin_stages') ?? []) {
		stageRow(row);
		if (
			typeof row.user_id !== 'number' ||
			!Number.isSafeInteger(row.user_id) ||
			row.user_id < 1 ||
			stages.has(row.id)
		) {
			throw new SnapshotFailure('unavailable');
		}
		if (row.status === 'staging') {
			throw new SnapshotFailure('source_changed');
		}
		if (
			row.status === 'failed' &&
			row.manifest_json !== null &&
			!(rows.get('agent_plugin_package_updates') ?? []).some(
				(update) => update.stage_id === row.id && update.user_id === row.user_id && update.data_migrated === 1,
			)
		) {
			throw new SnapshotFailure('unavailable');
		}
		stages.set(row.id, row);
	}
	const publishers = new Map<string, SqlRow>();
	for (const row of rows.get('agent_plugin_publishers') ?? []) {
		publisherRow(row);
		if (typeof row.user_id !== 'number' || !Number.isSafeInteger(row.user_id) || row.user_id < 1) {
			throw new SnapshotFailure('unavailable');
		}
		const key = JSON.stringify([row.user_id, row.key_id]);
		if (publishers.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
		publishers.set(key, row);
	}
	const archives = new Map<string, SqlRow>();
	for (const row of rows.get('agent_plugin_legacy_versions') ?? []) {
		const key = snapshotVersionKey(row);
		if (archives.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
		archives.set(key, row);
	}
	const versions = new Map<string, SqlRow>();
	const archivedSources = new Map<unknown, string>();
	for (const row of rows.get('agent_plugin_versions') ?? []) {
		const key = snapshotVersionKey(row);
		if (versions.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
		versions.set(key, row);
		const value = snapshotPluginVersion(row);
		const rawStage = stages.get(row.stage_id);
		if (
			!rawStage ||
			rawStage.package_hash !== row.package_hash ||
			!publishers.has(JSON.stringify([row.user_id, row.publisher_key_id]))
		) {
			throw new SnapshotFailure('unavailable');
		}
		const archived = archives.get(key);
		if (value.manifest !== null) {
			const stage = stageRow(rawStage);
			if (
				archived ||
				rawStage.user_id !== row.user_id ||
				stage.status !== 'installed' ||
				stage.publisherKeyId !== row.publisher_key_id ||
				JSON.stringify(stage.manifest) !== JSON.stringify(value.manifest)
			) {
				throw new SnapshotFailure('unavailable');
			}
		} else {
			if (
				!archived ||
				archived.package_hash !== row.package_hash ||
				archived.publisher_key_id !== row.publisher_key_id ||
				archived.stage_id !== row.stage_id ||
				archived.source_user_id !== rawStage.user_id ||
				typeof archived.source_user_id !== 'number' ||
				!Number.isSafeInteger(archived.source_user_id) ||
				archived.source_user_id < 1 ||
				archived.size_bytes !== rawStage.size_bytes ||
				typeof archived.manifest_json !== 'string' ||
				rawStage.status !== 'failed' ||
				(rawStage.manifest_json === null
					? rawStage.publisher_key_id !== null
					: typeof rawStage.manifest_json !== 'string' ||
						rawStage.publisher_key_id !== row.publisher_key_id) ||
				!publishers.has(JSON.stringify([archived.source_user_id, archived.publisher_key_id]))
			) {
				throw new SnapshotFailure('unavailable');
			}
			const original = snapshotLegacyManifest(JSON.parse(archived.manifest_json));
			if (
				typeof rawStage.manifest_json === 'string' &&
				snapshotLegacyManifest(JSON.parse(rawStage.manifest_json)).canonical !== original.canonical
			) {
				throw new SnapshotFailure('unavailable');
			}
			const source = JSON.stringify([archived.source_user_id, archived.publisher_key_id, original.canonical]);
			const previous = archivedSources.get(archived.stage_id);
			if (previous !== undefined && previous !== source) {
				throw new SnapshotFailure('unavailable');
			}
			archivedSources.set(archived.stage_id, source);
			if (JSON.stringify(original.summary) !== JSON.stringify(value.summary)) {
				throw new SnapshotFailure('unavailable');
			}
		}
	}
	for (const key of archives.keys()) {
		if (!versions.has(key)) {
			throw new SnapshotFailure('unavailable');
		}
	}
}

import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { stageRow, publisherRow } from '../../../plugins/adapters/sqlite/plugin-row.js';
import { packageReference } from '../../../plugins/adapters/sqlite/plugin-composition-sql.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';

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

/** Every retained version is a strictly decoded SDK4 package. */
export function snapshotPluginVersion(row: SqlRow) {
	snapshotVersionKey(row);
	if (typeof row.manifest_json !== 'string') {
		throw new SnapshotFailure('unavailable');
	}
	const input: unknown = JSON.parse(row.manifest_json);
	const manifest = pluginManifest(input);
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
	const versions = new Map<string, SqlRow>();
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
		const stage = stageRow(rawStage);
		if (
			rawStage.user_id !== row.user_id ||
			stage.status !== 'installed' ||
			stage.publisherKeyId !== row.publisher_key_id ||
			JSON.stringify(stage.manifest) !== JSON.stringify(value.manifest)
		) {
			throw new SnapshotFailure('unavailable');
		}
	}
}

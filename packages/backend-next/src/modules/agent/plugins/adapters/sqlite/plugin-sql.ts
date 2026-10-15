import { pluginRuntimeRow } from './plugin-runtime-row.js';
import { readPluginDataSnapshot, migratePluginData } from './plugin-migration-sql.js';
import type {
	StoredPluginDataSnapshot,
	StoredPluginDataMigration,
	StoredPluginDataMigrationResult,
} from '../../storage/plugin-migration-storage.js';
import { readPluginData, mutatePluginData } from './plugin-data-sql.js';
import { pluginInstallationRow } from './plugin-installation-row.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredPluginRuntimeObservation,
	StoredPluginRuntimeLease,
	StoredPluginDataPurge,
	StoredPluginData,
	StoredPluginDataMutation,
	PluginStorage,
	StoredPluginPublisher,
	StoredPluginStage,
	StoredPluginManifest,
	StoredPluginRecovery,
	StoredPluginInstallation,
	StoredPluginActivation,
	StoredPluginVersion,
	StoredPluginContentSource,
} from '../../storage/plugin-storage.js';
import type { AgentPluginStageStatus } from '@nexus-terminal/shared/agent/plugins/values';
import { PluginStorageRefusal, PluginRuntimeFenceRefusal } from '../../storage/plugin-storage.js';
import { publisherRow, stageRow } from './plugin-row.js';
import { pluginManifest } from '../package/plugin-manifest.js';

async function publishers(tx: SqlExecutor, userId: number): Promise<StoredPluginPublisher[]> {
	return (await tx.all('SELECT * FROM agent_plugin_publishers WHERE user_id=? ORDER BY key_id', [userId])).map(
		publisherRow,
	);
}

async function stage(tx: SqlExecutor, userId: number, id: string): Promise<StoredPluginStage | null> {
	const row = await tx.one('SELECT * FROM agent_plugin_stages WHERE user_id=? AND id=?', [userId, id]);
	return row === null ? null : stageRow(row);
}

export class SqlitePluginStorage implements PluginStorage {
	private async migrationAuthority(
		tx: SqlExecutor,
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			installation: StoredPluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
	): Promise<StoredPluginInstallation> {
		const current = await this.installation(tx, userId, appId);
		const retirement = await tx.one('SELECT stage_id FROM agent_plugin_retirements WHERE user_id=? AND app_id=?', [
			userId,
			appId,
		]);
		const runtime = await tx.one('SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?', [
			userId,
			appId,
		]);
		admit(
			await this.identity(tx, digest),
			current,
			runtime === null || runtime.state === 'closed',
			typeof retirement?.stage_id === 'string',
		);
		return current;
	}

	dataSnapshot(
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			installation: StoredPluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
	): Promise<StoredPluginDataSnapshot> {
		return this.db.transaction(async (tx) => {
			const current = await this.migrationAuthority(tx, userId, digest, appId, admit);
			const items = await readPluginDataSnapshot(tx, userId, appId);
			await this.migrationAuthority(tx, userId, digest, appId, admit);
			return { appId, revision: current.revision, items };
		});
	}

	migrateData(
		userId: number,
		digest: string,
		appId: string,
		input: StoredPluginDataMigration,
		admit: (
			identity: number | null,
			installation: StoredPluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
		admitCapacity: (keys: number, bytes: number, retained: number) => void,
	): Promise<StoredPluginDataMigrationResult> {
		return this.db.transaction(async (tx) => {
			await this.migrationAuthority(tx, userId, digest, appId, admit);
			const result = await migratePluginData(tx, userId, appId, input, admitCapacity);
			await this.migrationAuthority(tx, userId, digest, appId, admit);
			return result;
		});
	}

	async assertRuntimeClosed(userId: number, appId: string): Promise<void> {
		const row = await this.db.one('SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?', [
			userId,
			appId,
		]);
		if (row && row.state !== 'closed') {
			throw new PluginRuntimeFenceRefusal();
		}
	}

	observeRuntime(
		userId: number,
		digest: string,
		appId: string,
		admit: (identity: number | null) => void,
		instanceId: string | null,
	): Promise<StoredPluginRuntimeObservation | null> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			await this.installation(tx, userId, appId);
			const row =
				instanceId === null
					? await tx.one('SELECT * FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?', [
							userId,
							appId,
						])
					: await tx.one(
							'SELECT * FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND instance_id=? UNION ALL SELECT * FROM agent_plugin_runtime_history WHERE user_id=? AND app_id=? AND instance_id=?',
							[userId, appId, instanceId, userId, appId, instanceId],
						);
			return row === null ? null : pluginRuntimeRow(row);
		});
	}

	acknowledgeRuntime(
		userId: number,
		digest: string,
		appId: string,
		instanceId: string,
		instanceRevision: number,
		now: number,
		admit: (identity: number | null, installation: StoredPluginInstallation) => void,
	): Promise<StoredPluginRuntimeObservation> {
		return this.db.transaction(async (tx) => {
			const current = await this.installation(tx, userId, appId);
			admit(await this.identity(tx, digest), current);
			const row = await tx.one('SELECT * FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?', [
				userId,
				appId,
			]);
			if (!row) {
				throw new PluginStorageRefusal('not_found');
			}
			const observation = pluginRuntimeRow(row);
			if (
				observation.instanceId !== instanceId ||
				observation.revision !== instanceRevision ||
				(observation.state !== 'unknown' && observation.state !== 'closed')
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (observation.state === 'closed') {
				return observation;
			}
			await tx.run(
				"UPDATE agent_plugin_runtime_instances SET state='closed',updated_at=?,acknowledged_at=? WHERE user_id=? AND app_id=? AND instance_id=?",
				[now, now, userId, appId, instanceId],
			);
			admit(await this.identity(tx, digest), current);
			return {
				appId: observation.appId,
				instanceId: observation.instanceId,
				revision: observation.revision,
				state: 'closed',
				updatedAt: now,
				unknownAt: observation.unknownAt,
				acknowledgedAt: now,
			};
		});
	}

	recoverRuntimes(now: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				"UPDATE agent_plugin_runtime_instances SET state='unknown',updated_at=?,unknown_at=? WHERE state IN ('opening','active')",
				[now, now],
			);
		});
	}

	reserveRuntime(
		input: StoredPluginRuntimeLease,
		admit: (
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
			retained: number,
		) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_plugin_runtime_history WHERE user_id=?', [
				input.userId,
			]);
			if (!count || typeof count.count !== 'number' || !Number.isSafeInteger(count.count) || count.count < 0) {
				throw new Error('Corrupt runtime history count');
			}
			const retained = count.count;

			const validate = (
				current: StoredPluginInstallation,
				publisher: StoredPluginPublisher | null,
				enabled: boolean,
			) => admit(current, publisher, enabled, retained);

			const { current } = await this.runtimeAuthority(tx, input.userId, input.appId, validate);
			if (current.revision !== input.revision || current.status !== 'installed') {
				throw new PluginStorageRefusal('version_conflict');
			}
			const existing = await tx.one(
				'SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?',
				[input.userId, input.appId],
			);
			if (existing && existing.state !== 'closed') {
				throw new PluginRuntimeFenceRefusal();
			}
			if (existing) {
				await tx.run(
					'INSERT INTO agent_plugin_runtime_history(user_id,app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at) SELECT user_id,app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=?',
					[input.userId, input.appId],
				);
			}
			await tx.run(
				"INSERT INTO agent_plugin_runtime_instances(user_id,app_id,instance_id,revision,state,updated_at) VALUES(?,?,?,?,'opening',?) ON CONFLICT(user_id,app_id) DO UPDATE SET instance_id=excluded.instance_id,revision=excluded.revision,state='opening',updated_at=excluded.updated_at,unknown_at=NULL,acknowledged_at=NULL",
				[input.userId, input.appId, input.instanceId, input.revision, input.now],
			);
			await this.runtimeAuthority(tx, input.userId, input.appId, validate);
		});
	}

	settleRuntime(input: StoredPluginRuntimeLease, state: 'active' | 'closed' | 'unknown'): Promise<void> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND instance_id=? AND revision=?',
				[input.userId, input.appId, input.instanceId, input.revision],
			);
			if (
				!row ||
				(row.state !== 'opening' && row.state !== 'active' && row.state !== 'closed' && row.state !== 'unknown')
			) {
				throw new PluginStorageRefusal('operation_unknown');
			}
			if (row.state === 'unknown' || row.state === 'closed') {
				if (row.state === state) {
					return;
				}
				throw new PluginStorageRefusal('operation_unknown');
			}
			await tx.run(
				"UPDATE agent_plugin_runtime_instances SET state=?,updated_at=?,unknown_at=CASE WHEN ?='unknown' THEN ? ELSE unknown_at END WHERE user_id=? AND app_id=? AND instance_id=? AND revision=?",
				[state, input.now, state, input.now, input.userId, input.appId, input.instanceId, input.revision],
			);
		});
	}

	purgeData(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		operationId: string,
		now: number,
		admit: (identity: number | null, current: StoredPluginInstallation) => void,
		decide: (currentRevision: number, purgeCount: number) => void,
	): Promise<StoredPluginDataPurge> {
		return this.db.transaction(async (tx) => {
			const current = await this.installation(tx, userId, appId);
			admit(await this.identity(tx, digest), current);
			const replay = await tx.one(
				'SELECT expected_revision,result_revision,deleted_keys,updated_at FROM agent_plugin_data_purges WHERE user_id=? AND app_id=? AND operation_id=?',
				[userId, appId, operationId],
			);
			if (replay) {
				if (replay.expected_revision !== revision) {
					throw new PluginStorageRefusal('version_conflict');
				}
				if (
					typeof replay.result_revision !== 'number' ||
					!Number.isSafeInteger(replay.result_revision) ||
					replay.result_revision < 1 ||
					typeof replay.deleted_keys !== 'number' ||
					!Number.isSafeInteger(replay.deleted_keys) ||
					replay.deleted_keys < 0 ||
					typeof replay.updated_at !== 'number' ||
					!Number.isSafeInteger(replay.updated_at) ||
					replay.updated_at < 0
				) {
					throw new Error('Corrupt plugin data purge');
				}
				return {
					revision: replay.result_revision,
					deletedKeys: replay.deleted_keys,
					updatedAt: replay.updated_at,
				};
			}
			const count = await tx.one(
				'SELECT COUNT(*) AS count FROM agent_plugin_data_purges WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			if (typeof count?.count !== 'number') {
				throw new Error('Plugin purge count missing');
			}
			decide(current.revision, count.count);
			const live = await tx.one(
				'SELECT COUNT(*) AS count FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL',
				[userId, appId],
			);
			if (typeof live?.count !== 'number') {
				throw new Error('Plugin data count missing');
			}
			await tx.run(
				'UPDATE agent_plugin_data SET value_json=NULL,version=version+1,updated_at=? WHERE user_id=? AND app_id=? AND value_json IS NOT NULL',
				[now, userId, appId],
			);
			await tx.run(
				'UPDATE agent_plugin_data_operations SET value_json=NULL,retired=1 WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			await tx.run(
				'UPDATE agent_plugin_installations SET revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?',
				[now, userId, appId],
			);
			const result = { revision: current.revision + 1, deletedKeys: live.count, updatedAt: now };
			await tx.run('INSERT INTO agent_plugin_data_purges VALUES(?,?,?,?,?,?,?)', [
				userId,
				appId,
				operationId,
				revision,
				result.revision,
				result.deletedKeys,
				now,
			]);
			return result;
		});
	}

	private async dataAuthority(
		tx: SqlExecutor,
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
	): Promise<void> {
		const current = await this.installation(tx, userId, appId);
		const key = (await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null;
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
		if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
			throw new Error('Corrupt plugin App');
		}
		admit(await this.identity(tx, digest), current, key, app.enabled === 1);
	}

	withFrontendAdmission<T>(
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		work: () => Promise<T>,
	): Promise<T> {
		return this.db.withTransactionAdmission((tx) => this.dataAuthority(tx, userId, digest, appId, admit), work);
	}

	async frontendAuthority(
		tx: SqlExecutor,
		userId: number,
		digest: string,
		appId: string,
	): Promise<{
		identityUserId: number | null;
		revision: number;
		installed: boolean;
		enabled: boolean;
		trusted: boolean;
	}> {
		const current = await this.installation(tx, userId, appId);
		const key = (await publishers(tx, userId)).find((value) => value.keyId === current.publisherKeyId) ?? null;
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
		if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
			throw new Error('Corrupt plugin App');
		}
		return {
			identityUserId: await this.identity(tx, digest),
			revision: current.revision,
			installed: current.status === 'installed',
			enabled: app.enabled === 1,
			trusted: key !== null && key.revokedAt === null,
		};
	}

	readData(
		userId: number,
		digest: string,
		appId: string,
		key: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
	): Promise<StoredPluginData | null> {
		return this.db.transaction(async (tx) => {
			await this.dataAuthority(tx, userId, digest, appId, admit);
			return readPluginData(tx, userId, appId, key);
		});
	}

	mutateData(
		userId: number,
		digest: string,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		decide: (
			current: StoredPluginData | null,
			keyCount: number,
			operationCount: number,
			dataBytes: number,
			operationBytes: number,
		) => void,
	): Promise<StoredPluginData> {
		return this.db.transaction(async (tx) => {
			await this.dataAuthority(tx, userId, digest, appId, admit);
			const result = await mutatePluginData(tx, userId, appId, input, decide);
			await this.dataAuthority(tx, userId, digest, appId, admit);
			return result;
		});
	}

	async versions(userId: number): Promise<StoredPluginVersion[]> {
		const rows = await this.db.all(
			"SELECT DISTINCT v.definition_id,v.version,v.manifest_json,v.package_hash,v.publisher_key_id FROM agent_plugin_versions v JOIN agent_plugin_stages s ON s.package_hash=v.package_hash AND s.publisher_key_id=v.publisher_key_id WHERE s.user_id=? AND s.status='installed' ORDER BY v.definition_id,v.version",
			[userId],
		);
		return rows.map((row) => {
			if (
				typeof row.manifest_json !== 'string' ||
				typeof row.package_hash !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(row.package_hash) ||
				typeof row.publisher_key_id !== 'string' ||
				!/^ed25519:[a-f0-9]{64}$/u.test(row.publisher_key_id)
			) {
				throw new Error('Corrupt plugin version');
			}
			const manifest = pluginManifest(JSON.parse(row.manifest_json));
			if (manifest.id !== row.definition_id || manifest.version !== row.version) {
				throw new Error('Plugin version identity mismatch');
			}
			return { manifest, packageHash: row.package_hash, publisherKeyId: row.publisher_key_id };
		});
	}

	content(
		userId: number,
		digest: string,
		appId: string,
		version: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
	): Promise<StoredPluginContentSource> {
		return this.db.transaction(async (tx) => {
			const current = await this.installation(tx, userId, appId);
			const key = (await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null;
			const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
			if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
				throw new Error('Corrupt plugin App');
			}
			admit(await this.identity(tx, digest), current, key, app.enabled === 1);
			if (current.version !== version || !key) {
				throw new PluginStorageRefusal('version_conflict');
			}
			return this.packageSource(tx, current, key);
		});
	}

	private async packageSource(
		tx: SqlExecutor,
		current: StoredPluginInstallation,
		key: StoredPluginPublisher,
	): Promise<StoredPluginContentSource> {
		const version = current.version;
		const immutable = await tx.one(
			'SELECT stage_id,package_hash,publisher_key_id FROM agent_plugin_versions WHERE definition_id=? AND version=?',
			[current.definitionId, version],
		);
		if (
			!immutable ||
			typeof immutable.stage_id !== 'string' ||
			immutable.package_hash !== current.packageHash ||
			immutable.publisher_key_id !== current.publisherKeyId
		) {
			throw new Error('Plugin immutable package missing');
		}
		const row = await tx.one('SELECT * FROM agent_plugin_stages WHERE id=?', [immutable.stage_id]);
		if (!row) {
			throw new Error('Plugin package source missing');
		}
		const source = stageRow(row);
		if (
			source.packageHash !== current.packageHash ||
			source.publisherKeyId !== key.keyId ||
			source.manifest?.id !== current.definitionId ||
			source.manifest.version !== version ||
			source.status !== 'installed'
		) {
			throw new Error('Plugin package source mismatch');
		}
		return { installation: current, stage: source, publicKeyPem: key.publicKeyPem };
	}

	async runtimeTargets(): Promise<{ userId: number; appId: string }[]> {
		const rows = await this.db.all(
			"SELECT i.user_id,i.app_id FROM agent_plugin_installations i JOIN agent_apps a ON a.user_id=i.user_id AND a.id=i.app_id WHERE i.status=? AND a.enabled=1 AND NOT EXISTS(SELECT 1 FROM agent_plugin_runtime_instances r WHERE r.user_id=i.user_id AND r.app_id=i.app_id AND r.state='unknown')",
			['installed'],
		);
		return rows.map((row) => {
			if (
				typeof row.user_id !== 'number' ||
				!Number.isSafeInteger(row.user_id) ||
				row.user_id < 1 ||
				typeof row.app_id !== 'string'
			) {
				throw new Error('Corrupt plugin runtime target');
			}
			return { userId: row.user_id, appId: row.app_id };
		});
	}

	private async runtimeAuthority(
		tx: SqlExecutor,
		userId: number,
		appId: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<{ current: StoredPluginInstallation; key: StoredPluginPublisher | null }> {
		const current = await this.installation(tx, userId, appId);
		const key = (await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null;
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
		if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
			throw new Error('Corrupt plugin App');
		}
		admit(current, key, app.enabled === 1);
		return { current, key };
	}

	runtimeContent(
		userId: number,
		appId: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<StoredPluginContentSource> {
		return this.db.transaction(async (tx) => {
			const { current, key } = await this.runtimeAuthority(tx, userId, appId, admit);
			if (!key) {
				throw new PluginStorageRefusal('version_conflict');
			}
			return this.packageSource(tx, current, key);
		});
	}

	runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<StoredPluginData | null> {
		return this.db.transaction(async (tx) => {
			await this.runtimeAuthority(tx, userId, appId, admit);
			const result = await readPluginData(tx, userId, appId, key);
			await this.runtimeAuthority(tx, userId, appId, admit);
			return result;
		});
	}

	runtimeMutateData(
		userId: number,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		decide: (
			current: StoredPluginData | null,
			keyCount: number,
			operationCount: number,
			dataBytes: number,
			operationBytes: number,
		) => void,
	): Promise<StoredPluginData> {
		return this.db.transaction(async (tx) => {
			await this.runtimeAuthority(tx, userId, appId, admit);
			const result = await mutatePluginData(tx, userId, appId, input, decide);
			await this.runtimeAuthority(tx, userId, appId, admit);
			return result;
		});
	}

	private activation: ((tx: SqlExecutor, input: StoredPluginActivation) => Promise<void>) | null = null;
	private retirement: ((tx: SqlExecutor, userId: number, appId: string, now: number) => Promise<void>) | null = null;

	installScopeLifecycle(
		activate: (tx: SqlExecutor, input: StoredPluginActivation) => Promise<void>,
		retire: (tx: SqlExecutor, userId: number, appId: string, now: number) => Promise<void>,
	): void {
		if (this.activation || this.retirement) {
			throw new Error('Plugin Scope already installed');
		}
		this.activation = activate;
		this.retirement = retire;
	}

	async installations(userId: number): Promise<StoredPluginInstallation[]> {
		return (
			await this.db.all('SELECT * FROM agent_plugin_installations WHERE user_id=? ORDER BY definition_id', [
				userId,
			])
		).map(pluginInstallationRow);
	}

	install(
		userId: number,
		digest: string,
		stageId: string,
		version: number,
		appId: string,
		now: number,
		admit: (
			identity: number | null,
			stage: StoredPluginStage,
			publisher: StoredPluginPublisher | null,
			current: StoredPluginInstallation | null,
		) => void,
	): Promise<StoredPluginInstallation> {
		return this.db.transaction(async (tx) => {
			const staged = await stage(tx, userId, stageId);
			if (!staged) {
				throw new PluginStorageRefusal('not_found');
			}
			const manifest = staged.manifest;
			if (!manifest || !staged.publisherKeyId) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const trusted = (await publishers(tx, userId)).find((key) => key.keyId === staged.publisherKeyId) ?? null;
			const currentRow = await tx.one(
				'SELECT * FROM agent_plugin_installations WHERE user_id=? AND definition_id=?',
				[userId, manifest.id],
			);
			const current = currentRow === null ? null : pluginInstallationRow(currentRow);
			admit(await this.identity(tx, digest), staged, trusted, current);
			if (current?.status === 'draining') {
				const pending = await tx.one(
					'SELECT stage_id,stage_version FROM agent_plugin_retirements WHERE user_id=? AND app_id=?',
					[userId, current.appId],
				);
				if (!pending || pending.stage_id !== stageId || pending.stage_version !== version) {
					throw new PluginStorageRefusal('version_conflict');
				}
			}
			if (
				current?.status === 'installed' &&
				current.version === manifest.version &&
				current.packageHash === staged.packageHash
			) {
				return current;
			}
			if (staged.version !== version) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const immutable = await tx.one(
				'SELECT package_hash,publisher_key_id FROM agent_plugin_versions WHERE definition_id=? AND version=?',
				[manifest.id, manifest.version],
			);
			if (immutable) {
				if (
					immutable.package_hash !== staged.packageHash ||
					immutable.publisher_key_id !== staged.publisherKeyId
				) {
					throw new PluginStorageRefusal('version_conflict');
				}
			} else {
				await tx.run('INSERT INTO agent_plugin_versions VALUES(?,?,?,?,?,?)', [
					manifest.id,
					manifest.version,
					staged.packageHash,
					staged.publisherKeyId,
					stageId,
					JSON.stringify(manifest),
				]);
			}
			if (!this.activation) {
				throw new Error('Plugin Scope unavailable');
			}
			const id = current?.appId ?? appId;
			await this.activation(tx, {
				userId,
				appId: id,
				definitionId: manifest.id,
				definitionVersion: manifest.version,
				displayName: manifest.displayName,
				contentHash: staged.packageHash,
				capabilities: manifest.capabilities.map((item) => item),
				now,
			});
			await tx.run(
				"INSERT INTO agent_plugin_installations VALUES(?,?,?,?,?,?,'installed',1,?,?) ON CONFLICT(user_id,definition_id) DO UPDATE SET version=excluded.version,package_hash=excluded.package_hash,publisher_key_id=excluded.publisher_key_id,status='installed',revision=revision+1,updated_at=excluded.updated_at",
				[userId, id, manifest.id, manifest.version, staged.packageHash, staged.publisherKeyId, now, now],
			);
			await tx.run(
				"UPDATE agent_plugin_stages SET status='installed',version=version+1,updated_at=? WHERE id=?",
				[now, stageId],
			);
			await tx.run('DELETE FROM agent_plugin_retirements WHERE user_id=? AND app_id=?', [userId, id]);
			const installed = await tx.one(
				'SELECT * FROM agent_plugin_installations WHERE user_id=? AND definition_id=?',
				[userId, manifest.id],
			);
			if (!installed) {
				throw new Error('Installed plugin missing');
			}
			return pluginInstallationRow(installed);
		});
	}

	private async installation(tx: SqlExecutor, userId: number, appId: string): Promise<StoredPluginInstallation> {
		const row = await tx.one('SELECT * FROM agent_plugin_installations WHERE user_id=? AND app_id=?', [
			userId,
			appId,
		]);
		if (!row) {
			throw new PluginStorageRefusal('not_found');
		}
		return pluginInstallationRow(row);
	}

	beginRetirement(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		stageId: string | null,
		stageVersion: number | null,
		now: number,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			stage: StoredPluginStage | null,
			publisher: StoredPluginPublisher | null,
		) => void,
	): Promise<StoredPluginInstallation> {
		return this.db.transaction(async (tx) => {
			const current = await this.installation(tx, userId, appId);
			const replacement = stageId === null ? null : await stage(tx, userId, stageId);
			const key = replacement?.publisherKeyId ?? current.publisherKeyId;
			const publisher = (await publishers(tx, userId)).find((item) => item.keyId === key) ?? null;
			admit(await this.identity(tx, digest), current, replacement, publisher);
			if (current.revision !== revision) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (current.status === 'draining') {
				const pending = await tx.one(
					'SELECT stage_id,stage_version FROM agent_plugin_retirements WHERE user_id=? AND app_id=?',
					[userId, appId],
				);
				if (!pending || pending.stage_id !== stageId || pending.stage_version !== stageVersion) {
					throw new PluginStorageRefusal('version_conflict');
				}
				return current;
			}
			if (!this.retirement) {
				throw new Error('Plugin retirement unavailable');
			}
			await this.retirement(tx, userId, appId, now);
			await tx.run(
				"UPDATE agent_plugin_installations SET status='draining',revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?",
				[now, userId, appId],
			);
			await tx.run('INSERT INTO agent_plugin_retirements VALUES(?,?,?,?,?,?)', [
				userId,
				appId,
				stageId,
				stageVersion,
				now,
				current.revision + 1,
			]);
			return this.installation(tx, userId, appId);
		});
	}

	finishRemoval(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		now: number,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginInstallation> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const current = await this.installation(tx, userId, appId);
			const pending = await tx.one('SELECT stage_id FROM agent_plugin_retirements WHERE user_id=? AND app_id=?', [
				userId,
				appId,
			]);
			if (
				current.revision !== revision ||
				current.status !== 'draining' ||
				!pending ||
				pending.stage_id !== null
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			await tx.run(
				"UPDATE agent_plugin_installations SET status='removed',revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?",
				[now, userId, appId],
			);
			await tx.run('DELETE FROM agent_plugin_retirements WHERE user_id=? AND app_id=?', [userId, appId]);
			return this.installation(tx, userId, appId);
		});
	}

	cancelRetirement(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		now: number,
		admit: (identity: number | null, publisher: StoredPluginPublisher | null, dataMigrated: boolean) => void,
	): Promise<StoredPluginInstallation> {
		return this.db.transaction(async (tx) => {
			const current = await this.installation(tx, userId, appId);
			const publisher =
				(await publishers(tx, userId)).find((key) => key.keyId === current.publisherKeyId) ?? null;
			const pending = await tx.one(
				'SELECT app_id,base_revision FROM agent_plugin_retirements WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			if (current.revision !== revision || current.status !== 'draining' || !pending) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (
				typeof pending.base_revision !== 'number' ||
				!Number.isSafeInteger(pending.base_revision) ||
				pending.base_revision < 1
			) {
				throw new Error('Corrupt retirement revision');
			}
			admit(await this.identity(tx, digest), publisher, current.revision > pending.base_revision);
			await tx.run(
				"UPDATE agent_plugin_installations SET status='installed',revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?",
				[now, userId, appId],
			);
			await tx.run('DELETE FROM agent_plugin_retirements WHERE user_id=? AND app_id=?', [userId, appId]);
			return this.installation(tx, userId, appId);
		});
	}

	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Plugin identity already installed');
		}
		this.readIdentity = read;
	}

	private identity(tx: SqlExecutor, digest: string): Promise<number | null> {
		if (!this.readIdentity) {
			throw new Error('Plugin identity unavailable');
		}
		return this.readIdentity(tx, digest);
	}

	async stages(userId: number): Promise<StoredPluginStage[]> {
		return (
			await this.db.all('SELECT * FROM agent_plugin_stages WHERE user_id=? ORDER BY created_at,id', [userId])
		).map(stageRow);
	}

	async recovery(): Promise<StoredPluginRecovery[]> {
		return (await this.db.all("SELECT * FROM agent_plugin_stages WHERE status='staging' ORDER BY id")).map(
			(row) => {
				if (typeof row.user_id !== 'number' || !Number.isSafeInteger(row.user_id) || row.user_id < 1) {
					throw new Error('Corrupt plugin recovery owner');
				}
				return { userId: row.user_id, stage: stageRow(row) };
			},
		);
	}

	recoverStage(userId: number, id: string, version: number, status: 'staged' | 'failed', now: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			const row = await stage(tx, userId, id);
			if (!row || row.version !== version || row.status !== 'staging') {
				throw new PluginStorageRefusal('version_conflict');
			}
			await tx.run(
				'UPDATE agent_plugin_stages SET status=?,version=version+1,updated_at=? WHERE user_id=? AND id=?',
				[status, now, userId, id],
			);
		});
	}

	publishers(userId: number): Promise<StoredPluginPublisher[]> {
		return publishers(this.db, userId);
	}

	putPublisher(
		userId: number,
		digest: string,
		record: StoredPluginPublisher,
		admit: (identity: number | null, existing: StoredPluginPublisher | null, count: number) => void,
	): Promise<StoredPluginPublisher> {
		return this.db.transaction(async (tx) => {
			const existing = (await publishers(tx, userId)).find((item) => item.keyId === record.keyId) ?? null;
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_plugin_publishers WHERE user_id=?', [
				userId,
			]);
			if (typeof count?.count !== 'number') {
				throw new Error('Publisher count missing');
			}
			admit(await this.identity(tx, digest), existing, count.count);
			if (existing) {
				return existing;
			}
			await tx.run('INSERT INTO agent_plugin_publishers VALUES(?,?,?,?,?,?,NULL)', [
				userId,
				record.keyId,
				record.publicKeyPem,
				record.label,
				record.version,
				record.createdAt,
			]);
			return {
				keyId: record.keyId,
				publicKeyPem: record.publicKeyPem,
				label: record.label,
				version: record.version,
				createdAt: record.createdAt,
				revokedAt: null,
			};
		});
	}

	revokePublisher(
		userId: number,
		digest: string,
		keyId: string,
		version: number,
		now: number,
		admit: (identity: number | null) => void,
	): Promise<{ publisher: StoredPluginPublisher; appIds: string[] }> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const current = (await publishers(tx, userId)).find((item) => item.keyId === keyId);
			if (!current) {
				throw new PluginStorageRefusal('not_found');
			}
			if (current.version !== version) {
				throw new PluginStorageRefusal('version_conflict');
			}
			await tx.run(
				'UPDATE agent_plugin_publishers SET revoked_at=?,version=version+1 WHERE user_id=? AND key_id=?',
				[now, userId, keyId],
			);
			if (!this.retirement) {
				throw new Error('Plugin Scope retirement unavailable');
			}
			const active = await tx.all(
				"SELECT app_id FROM agent_plugin_installations WHERE user_id=? AND publisher_key_id=? AND status='installed'",
				[userId, keyId],
			);
			const appIds: string[] = [];
			for (const row of active) {
				if (typeof row.app_id !== 'string') {
					throw new Error('Corrupt plugin App reference');
				}
				appIds.push(row.app_id);
				await this.retirement(tx, userId, row.app_id, now);
			}

			return {
				appIds,
				publisher: {
					keyId: current.keyId,
					publicKeyPem: current.publicKeyPem,
					label: current.label,
					version: current.version + 1,
					createdAt: current.createdAt,
					revokedAt: now,
				},
			};
		});
	}

	createStage(
		userId: number,
		digest: string,
		record: StoredPluginStage,
		admit: (identity: number | null, count: number) => void,
	): Promise<StoredPluginStage> {
		return this.db.transaction(async (tx) => {
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_plugin_stages WHERE user_id=?', [userId]);
			if (typeof count?.count !== 'number') {
				throw new Error('Stage count missing');
			}
			admit(await this.identity(tx, digest), count.count);
			await tx.run('INSERT INTO agent_plugin_stages VALUES(?,?,?,?,?,?,?,?,?,?)', [
				record.id,
				userId,
				record.packageHash,
				record.sizeBytes,
				record.status,
				record.version,
				record.publisherKeyId,
				record.manifest === null ? null : JSON.stringify(record.manifest),
				record.createdAt,
				record.updatedAt,
			]);
			const saved = await stage(tx, userId, record.id);
			if (!saved) {
				throw new Error('Created stage missing');
			}
			return saved;
		});
	}

	getStage(userId: number, id: string): Promise<StoredPluginStage | null> {
		return stage(this.db, userId, id);
	}

	updateStage(
		userId: number,
		digest: string,
		id: string,
		version: number,
		now: number,
		decide: (
			identity: number | null,
			current: StoredPluginStage,
			publishers: StoredPluginPublisher[],
		) => { status: AgentPluginStageStatus; manifest: StoredPluginManifest | null; publisherKeyId: string | null },
	): Promise<StoredPluginStage> {
		return this.db.transaction(async (tx) => {
			const current = await stage(tx, userId, id);
			if (!current) {
				throw new PluginStorageRefusal('not_found');
			}
			if (current.version !== version) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const task = decide(await this.identity(tx, digest), current, await publishers(tx, userId));
			await tx.run(
				'UPDATE agent_plugin_stages SET status=?,manifest_json=?,publisher_key_id=?,version=version+1,updated_at=? WHERE id=?',
				[
					task.status,
					task.manifest === null ? null : JSON.stringify(task.manifest),
					task.publisherKeyId,
					now,
					id,
				],
			);
			const saved = await stage(tx, userId, id);
			if (!saved) {
				throw new Error('Updated stage missing');
			}
			return saved;
		});
	}
}

import { clearPluginInstanceSettings } from './plugin-instance-clear.js';
import { clearPluginPrivateData } from './plugin-private-data-clear.js';
import { ensurePluginInstances, readPluginInstanceSource } from './plugin-instance-sql.js';
import { PluginInstanceRefusal } from '../../storage/plugin-instance-storage.js';
import { readPluginExtensionData, mutatePluginExtensionData } from './plugin-extension-data-sql.js';
import type {
	StoredPluginAppBinding,
	StoredPluginCompositionCandidate,
	StoredPluginPackageUpdateFacts,
} from '../../storage/plugin-composition-storage.js';
import {
	packageInstallation,
	readAppBinding,
	writeAppBinding,
	writeAppPackageReferences,
} from './plugin-composition-sql.js';
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
	StoredPluginInstallationDirectory,
	StoredPluginActivation,
	StoredPluginVersion,
	StoredPluginContentSource,
} from '../../storage/plugin-storage.js';
import type { AgentPluginStageStatus } from '@nexus-terminal/shared/agent/plugins/values';
import { AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import { PluginStorageRefusal, PluginRuntimeFenceRefusal } from '../../storage/plugin-storage.js';
import { publisherRow, stageRow } from './plugin-row.js';
import { appExecutionBinding } from './plugin-app-execution-sql.js';
import { pluginManifest } from '../package/plugin-manifest.js';

interface PluginConfigurationLifecycle {
	retainedApps(tx: SqlExecutor, userId: number): Promise<string[]>;
	clear(tx: SqlExecutor, userId: number, appId: string): Promise<void>;
}

async function publishers(tx: SqlExecutor, userId: number): Promise<StoredPluginPublisher[]> {
	return (await tx.all('SELECT * FROM agent_plugin_publishers WHERE user_id=? ORDER BY key_id', [userId])).map(
		publisherRow,
	);
}

async function stage(tx: SqlExecutor, userId: number, id: string): Promise<StoredPluginStage | null> {
	const row = await tx.one('SELECT * FROM agent_plugin_stages WHERE user_id=? AND id=?', [userId, id]);
	return row === null ? null : stageRow(row);
}

function assertRevisionAvailable(value: number): void {
	if (value === Number.MAX_SAFE_INTEGER) {
		throw new PluginStorageRefusal('version_conflict');
	}
}

export class SqlitePluginStorage implements PluginStorage {
	appExecutionBinding(
		userId: number,
		appId: string,
		allowDraining: boolean,
	): ReturnType<PluginStorage['appExecutionBinding']> {
		return this.db.transaction((tx) => appExecutionBinding(tx, userId, appId, allowDraining));
	}

	packageDirectory(userId: number): ReturnType<PluginStorage['packageDirectory']> {
		return this.db.transaction(async (tx) => ({
			installations: (
				await tx.all('SELECT * FROM agent_plugin_packages WHERE user_id=? ORDER BY package_id', [userId])
			).map(packageInstallation),
			retainedPackageIds: await this.retainedPackageData(tx, userId),
		}));
	}

	appBindings(userId: number): Promise<StoredPluginAppBinding[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				"SELECT app_id FROM agent_plugin_installations WHERE user_id=? AND status<>'removed' ORDER BY app_id",
				[userId],
			);
			const result: StoredPluginAppBinding[] = [];
			for (const row of rows) {
				if (typeof row.app_id !== 'string') {
					throw new Error('Corrupt App identity');
				}
				const binding = await readAppBinding(tx, userId, row.app_id);
				if (!binding) {
					throw new Error('App binding missing');
				}
				result.push(binding);
			}
			return result;
		});
	}

	packageRetainedData(userId: number): Promise<string[]> {
		return this.db.transaction((tx) => this.retainedPackageData(tx, userId));
	}

	private async retainedPackageData(tx: SqlExecutor, userId: number): Promise<string[]> {
		const rows = await tx.all(
			`SELECT DISTINCT p.package_id FROM agent_plugin_packages p WHERE p.user_id=? AND p.status='removed' AND
		 (EXISTS(SELECT 1 FROM agent_plugin_extension_data d WHERE d.user_id=p.user_id AND d.package_id=p.package_id AND d.value_json IS NOT NULL)
		 OR EXISTS(SELECT 1 FROM agent_plugin_private_data private WHERE private.user_id=p.user_id AND private.package_id=p.package_id AND private.document_json IS NOT NULL)
		 OR EXISTS(SELECT 1 FROM agent_plugin_instances logical JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version AND v.package_hash=p.package_hash AND v.publisher_key_id=p.publisher_key_id LEFT JOIN agent_plugin_connections connector ON connector.instance_id=logical.id WHERE logical.user_id=p.user_id AND logical.package_id=p.package_id AND (logical.configuration_json<>COALESCE(json_extract(v.manifest_json,'$.contributions.settings.defaultsJson'),'{}') OR (connector.instance_id IS NOT NULL AND (connector.connector_json<>'{"kind":"none"}' OR connector.encrypted_credential IS NOT NULL))))
		 OR EXISTS(SELECT 1 FROM agent_plugin_data d JOIN agent_plugin_installations i ON i.user_id=d.user_id AND i.app_id=d.app_id WHERE i.user_id=p.user_id AND i.definition_id=p.package_id AND d.value_json IS NOT NULL)) ORDER BY p.package_id`,
			[userId],
		);
		const retained = new Set(
			rows.map((row) => {
				if (typeof row.package_id !== 'string') {
					throw new Error('Corrupt retained package');
				}
				return row.package_id;
			}),
		);
		if (!this.configuration) {
			throw new Error('Plugin configuration lifecycle unavailable');
		}
		const configured = new Set(await this.configuration.retainedApps(tx, userId));
		if (configured.size) {
			const apps = await tx.all(
				"SELECT i.app_id,p.package_id FROM agent_plugin_installations i JOIN agent_plugin_packages p ON p.user_id=i.user_id AND p.package_id=i.definition_id WHERE p.user_id=? AND p.status='removed'",
				[userId],
			);
			for (const app of apps) {
				if (typeof app.app_id !== 'string' || typeof app.package_id !== 'string') {
					throw new Error('Corrupt retained package App');
				}
				if (configured.has(app.app_id)) {
					retained.add(app.package_id);
				}
			}
		}
		return [...retained].sort();
	}

	removePackage(...args: Parameters<PluginStorage['removePackage']>): ReturnType<PluginStorage['removePackage']> {
		const [userId, digest, packageId, revision, clearData, now, admit] = args;
		return this.db.transaction(async (tx) => {
			const row = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				packageId,
			]);
			if (!row) {
				throw new PluginStorageRefusal('not_found');
			}
			const current = packageInstallation(row);
			const referenced = await tx.one(
				"SELECT 1 FROM agent_plugin_app_packages ref JOIN agent_plugin_installations i ON i.user_id=ref.user_id AND i.app_id=ref.app_id WHERE ref.user_id=? AND ref.package_id=? AND i.status<>'removed' LIMIT 1",
				[userId, packageId],
			);
			const runtime = await tx.one(
				"SELECT 1 FROM agent_plugin_runtime_instances WHERE user_id=? AND package_id=? AND state<>'closed' LIMIT 1",
				[userId, packageId],
			);
			const pending = await tx.one(
				'SELECT 1 FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?',
				[userId, packageId],
			);
			admit(await this.identity(tx, digest), current, referenced !== null, runtime === null, pending !== null);
			if (current.revision !== revision) {
				throw new PluginStorageRefusal('version_conflict');
			}
			assertRevisionAvailable(current.revision);
			if (clearData) {
				await clearPluginPrivateData(tx, userId, { kind: 'package', packageId }, now);
				await clearPluginInstanceSettings(tx, userId, { kind: 'package', packageId }, now);
				const exhausted = await tx.one(
					'SELECT 1 FROM agent_plugin_extension_data WHERE user_id=? AND package_id=? AND value_json IS NOT NULL AND version>=? UNION ALL SELECT 1 FROM agent_plugin_data d JOIN agent_plugin_installations i ON i.user_id=d.user_id AND i.app_id=d.app_id WHERE i.user_id=? AND i.definition_id=? AND d.value_json IS NOT NULL AND d.version>=? LIMIT 1',
					[userId, packageId, Number.MAX_SAFE_INTEGER, userId, packageId, Number.MAX_SAFE_INTEGER],
				);
				if (exhausted) {
					throw new PluginStorageRefusal('version_conflict');
				}
				await tx.run(
					'UPDATE agent_plugin_extension_data SET value_json=NULL,version=version+1,updated_at=? WHERE user_id=? AND package_id=? AND value_json IS NOT NULL',
					[now, userId, packageId],
				);
				await tx.run(
					'UPDATE agent_plugin_extension_operations SET value_json=NULL,retired=1 WHERE user_id=? AND package_id=?',
					[userId, packageId],
				);
				await tx.run(
					'UPDATE agent_plugin_data SET value_json=NULL,version=version+1,updated_at=? WHERE user_id=? AND app_id IN (SELECT app_id FROM agent_plugin_installations WHERE user_id=? AND definition_id=?) AND value_json IS NOT NULL',
					[now, userId, userId, packageId],
				);
				await tx.run(
					'UPDATE agent_plugin_data_operations SET value_json=NULL,retired=1 WHERE user_id=? AND app_id IN (SELECT app_id FROM agent_plugin_installations WHERE user_id=? AND definition_id=?)',
					[userId, userId, packageId],
				);
				await tx.run(
					"UPDATE agent_plugin_stages SET manifest_json=NULL,publisher_key_id=NULL WHERE user_id=? AND status='failed' AND id IN (SELECT stage_id FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?)",
					[userId, userId, packageId],
				);
				await tx.run('DELETE FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?', [
					userId,
					packageId,
				]);
				if (!this.configuration) {
					throw new Error('Plugin configuration lifecycle unavailable');
				}
				const apps = await tx.all(
					'SELECT app_id FROM agent_plugin_installations WHERE user_id=? AND definition_id=?',
					[userId, packageId],
				);
				for (const app of apps) {
					if (typeof app.app_id !== 'string') {
						throw new Error('Corrupt package App');
					}
					await this.configuration.clear(tx, userId, app.app_id);
				}
			}
			await tx.run(
				"UPDATE agent_plugin_packages SET status='removed',revision=revision+1,updated_at=? WHERE user_id=? AND package_id=?",
				[now, userId, packageId],
			);
			const result = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				packageId,
			]);
			if (!result) {
				throw new Error('Removed package missing');
			}
			return packageInstallation(result);
		});
	}

	cancelPackageUpdate(
		...args: Parameters<PluginStorage['cancelPackageUpdate']>
	): ReturnType<PluginStorage['cancelPackageUpdate']> {
		const [userId, digest, packageId, revision, now, admit] = args;
		return this.db.transaction(async (tx) => {
			const row = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				packageId,
			]);
			if (!row) {
				throw new PluginStorageRefusal('not_found');
			}
			const current = packageInstallation(row);
			admit(await this.identity(tx, digest), current);
			const pending = await tx.one(
				'SELECT data_migrated FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?',
				[userId, packageId],
			);
			if (
				current.revision !== revision ||
				current.status !== 'draining' ||
				!pending ||
				pending.data_migrated !== 0
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const runtime = await tx.one(
				"SELECT 1 FROM agent_plugin_runtime_instances r JOIN agent_plugin_app_packages ref ON ref.user_id=r.user_id AND ref.app_id=r.app_id WHERE ref.user_id=? AND ref.package_id=? AND r.state<>'closed' LIMIT 1",
				[userId, packageId],
			);
			if (runtime) {
				throw new PluginRuntimeFenceRefusal();
			}
			assertRevisionAvailable(current.revision);
			await tx.run('DELETE FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?', [
				userId,
				packageId,
			]);
			await tx.run(
				"UPDATE agent_plugin_packages SET status='installed',revision=revision+1,updated_at=? WHERE user_id=? AND package_id=?",
				[now, userId, packageId],
			);
			return {
				package: current.package,
				status: 'installed',
				revision: current.revision + 1,
				createdAt: current.createdAt,
				updatedAt: now,
			};
		});
	}

	updatePackage(...args: Parameters<PluginStorage['updatePackage']>): ReturnType<PluginStorage['updatePackage']> {
		const [userId, digest, packageId, revision, stageId, stageVersion, now, phase, admit] = args;
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT p.*,v.manifest_json FROM agent_plugin_packages p JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version WHERE p.user_id=? AND p.package_id=?',
				[userId, packageId],
			);
			const staged = await stage(tx, userId, stageId);
			if (!row || !staged) {
				throw new PluginStorageRefusal('not_found');
			}
			if (
				typeof row.manifest_json !== 'string' ||
				!staged.manifest ||
				!staged.publisherKeyId ||
				staged.version !== stageVersion
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const current = packageInstallation(row);
			if (current.status === 'incompatible') {
				throw new PluginStorageRefusal('version_conflict');
			}
			const immutable = await tx.one(
				'SELECT * FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=?',
				[userId, packageId, staged.manifest.version],
			);
			if (
				immutable &&
				(immutable.package_hash !== staged.packageHash || immutable.publisher_key_id !== staged.publisherKeyId)
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (current.revision !== revision) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const publisher =
				(await publishers(tx, userId)).find((item) => item.keyId === staged.publisherKeyId) ?? null;
			const rows = await tx.all(
				"SELECT DISTINCT i.app_id,v.manifest_json FROM agent_plugin_app_packages ref JOIN agent_plugin_installations i ON i.user_id=ref.user_id AND i.app_id=ref.app_id JOIN agent_plugin_versions v ON v.user_id=i.user_id AND v.definition_id=i.definition_id AND v.version=i.version WHERE ref.user_id=? AND ref.package_id=? AND i.status<>'removed' ORDER BY i.app_id",
				[userId, packageId],
			);
			const references: StoredPluginPackageUpdateFacts['references'] = [];
			for (const reference of rows) {
				if (typeof reference.app_id !== 'string' || typeof reference.manifest_json !== 'string') {
					throw new Error('Corrupt package reference');
				}
				const binding = await readAppBinding(tx, userId, reference.app_id);
				if (!binding) {
					throw new Error('Package composition missing');
				}
				references.push({ binding, manifest: pluginManifest(JSON.parse(reference.manifest_json)) });
			}
			const candidateRows = await tx.all(
				"SELECT p.*,v.manifest_json FROM agent_plugin_packages p JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version WHERE p.user_id=? AND p.status IN ('installed','draining') ORDER BY p.package_id",
				[userId],
			);
			const trusted = await publishers(tx, userId);
			const candidates: StoredPluginCompositionCandidate[] = candidateRows.map((candidate) => {
				if (typeof candidate.manifest_json !== 'string') {
					throw new Error('Package manifest missing');
				}
				return {
					installation: packageInstallation(candidate),
					manifest: pluginManifest(JSON.parse(candidate.manifest_json)),
					publisher: trusted.find((item) => item.keyId === candidate.publisher_key_id) ?? null,
				};
			});
			const decision = admit(await this.identity(tx, digest), {
				candidates,
				current,
				previousManifest: pluginManifest(JSON.parse(row.manifest_json)),
				stage: staged,
				publisher,
				references,
			});
			const uiOnly = decision.uiOnly;
			assertRevisionAvailable(current.revision);
			const pending = await tx.one(
				'SELECT stage_id,stage_version FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?',
				[userId, packageId],
			);
			if (pending && (pending.stage_id !== stageId || pending.stage_version !== stageVersion)) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (phase === 'prepare') {
				if (!uiOnly && !pending) {
					await tx.run(
						'INSERT INTO agent_plugin_package_updates(user_id,package_id,stage_id,stage_version,created_at) VALUES(?,?,?,?,?)',
						[userId, packageId, stageId, stageVersion, now],
					);
				}
				if (!uiOnly && current.status !== 'draining') {
					await tx.run(
						"UPDATE agent_plugin_packages SET status='draining',revision=revision+1,updated_at=? WHERE user_id=? AND package_id=?",
						[now, userId, packageId],
					);
				}
			} else {
				if (!uiOnly) {
					if (current.status !== 'draining' || !pending) {
						throw new PluginStorageRefusal('version_conflict');
					}
					for (const impact of decision.impacts) {
						const runtimes = await tx.all(
							"SELECT package_id FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND state<>'closed'",
							[userId, impact.appId],
						);
						if (
							runtimes.some((runtime) => {
								if (typeof runtime.package_id !== 'string') {
									throw new Error('Invalid runtime package identity');
								}
								return impact.restartApp || impact.packageIds.includes(runtime.package_id);
							})
						) {
							throw new PluginRuntimeFenceRefusal();
						}
					}
				}
				const manifest = staged.manifest;
				if (!immutable) {
					await tx.run('INSERT INTO agent_plugin_versions VALUES(?,?,?,?,?,?,?)', [
						userId,
						packageId,
						manifest.version,
						staged.packageHash,
						staged.publisherKeyId,
						stageId,
						JSON.stringify(manifest),
					]);
				}
				for (const reference of references) {
					if (!uiOnly) {
						if (!this.activation) {
							throw new Error('Plugin Scope unavailable');
						}

						const selected = decision.bindings.find((binding) => binding.appId === reference.binding.appId);
						if (!selected) {
							throw new PluginStorageRefusal('version_conflict');
						}
						const appReference = selected.app;
						const tools = selected.dependencies;
						const appManifest = appReference.packageId === packageId ? manifest : reference.manifest;
						const executionPackages: StoredPluginActivation['executionPackages'] = [
							{
								packageId: appReference.packageId,
								kind: 'app',
								version: appReference.version,
								packageHash: appReference.packageHash,
								publisherKeyId: appReference.publisherKeyId,
							},
						];
						for (const tool of tools) {
							executionPackages.push({
								packageId: tool.packageId,
								kind: 'tool',
								version: tool.version,
								packageHash: tool.packageHash,
								publisherKeyId: tool.publisherKeyId,
							});
						}
						const capabilities: StoredPluginManifest['capabilities'] = [];
						for (const item of executionPackages) {
							const stored = await tx.one(
								'SELECT manifest_json FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=?',
								[userId, item.packageId, item.version],
							);
							if (typeof stored?.manifest_json !== 'string') {
								throw new Error('Execution package manifest missing');
							}
							for (const capability of pluginManifest(JSON.parse(stored.manifest_json)).capabilities) {
								if (!capabilities.includes(capability)) {
									capabilities.push(capability);
								}
							}
						}
						const appState = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [
							userId,
							reference.binding.appId,
						]);
						if (!appState || (appState.enabled !== 0 && appState.enabled !== 1)) {
							throw new Error('Plugin App state missing');
						}
						const impact = decision.impacts.find((value) => value.appId === reference.binding.appId);
						if (!impact) {
							throw new Error('Missing package update impact');
						}
						await this.activation(tx, {
							mode: impact.restartApp ? 'install' : 'provider',
							userId,
							appId: reference.binding.appId,
							definitionId: appReference.packageId,
							definitionVersion: appReference.version,
							contentHash: appReference.packageHash,
							displayName: appManifest.displayName,
							capabilities,
							executionPackages,
							enabled: appState.enabled === 1,
							grantedCapabilities: null,
							now,
						});
					}
					assertRevisionAvailable(reference.binding.uiRevision);
					if (!uiOnly) {
						assertRevisionAvailable(reference.binding.executionRevision);
					}
					const selected = decision.bindings.find((binding) => binding.appId === reference.binding.appId);
					if (!selected) {
						throw new PluginStorageRefusal('version_conflict');
					}
					await tx.run('DELETE FROM agent_plugin_app_packages WHERE user_id=? AND app_id=?', [
						userId,
						reference.binding.appId,
					]);
					await writeAppPackageReferences(tx, userId, selected);
					await tx.run(
						'UPDATE agent_plugin_app_bindings SET execution_revision=execution_revision+?,ui_revision=ui_revision+? WHERE user_id=? AND app_id=?',
						[
							uiOnly ? 0 : 1,
							!uiOnly || reference.binding.ui?.packageId === packageId ? 1 : 0,
							userId,
							reference.binding.appId,
						],
					);
					if (!uiOnly) {
						await tx.run(
							'UPDATE agent_plugin_installations SET revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?',
							[now, userId, reference.binding.appId],
						);
						if (reference.binding.app.packageId === packageId) {
							await tx.run(
								'UPDATE agent_plugin_installations SET version=?,package_hash=?,publisher_key_id=? WHERE user_id=? AND app_id=?',
								[
									manifest.version,
									staged.packageHash,
									staged.publisherKeyId,
									userId,
									reference.binding.appId,
								],
							);
						}
					}
				}
				await tx.run(
					"UPDATE agent_plugin_packages SET version=?,package_hash=?,publisher_key_id=?,status='installed',revision=revision+1,updated_at=? WHERE user_id=? AND package_id=?",
					[manifest.version, staged.packageHash, staged.publisherKeyId, now, userId, packageId],
				);
				assertRevisionAvailable(staged.version);
				await tx.run(
					"UPDATE agent_plugin_stages SET status='installed',version=version+1,updated_at=? WHERE id=? AND user_id=?",
					[now, stageId, userId],
				);
				await tx.run('DELETE FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?', [
					userId,
					packageId,
				]);
			}
			const result = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				packageId,
			]);
			if (!result) {
				throw new Error('Updated package missing');
			}
			return {
				installation: packageInstallation(result),
				dependencies: decision.dependencies,
				uiOnly,
				impacts: decision.impacts,
				appIds: references.map((reference) => reference.binding.appId),
			};
		});
	}

	packageInstallations(userId: number): ReturnType<PluginStorage['packageInstallations']> {
		return this.db
			.all('SELECT * FROM agent_plugin_packages WHERE user_id=? ORDER BY package_id', [userId])
			.then((rows) => rows.map(packageInstallation));
	}

	installPackage(...args: Parameters<PluginStorage['installPackage']>): ReturnType<PluginStorage['installPackage']> {
		const [userId, digest, stageId, stageVersion, now, admit] = args;
		return this.db.transaction(async (tx) => {
			const staged = await stage(tx, userId, stageId);
			if (!staged) {
				throw new PluginStorageRefusal('not_found');
			}
			if (!staged.manifest || !staged.publisherKeyId || staged.version !== stageVersion) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const manifest = staged.manifest;
			const key = (await publishers(tx, userId)).find((item) => item.keyId === staged.publisherKeyId) ?? null;
			const row = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				manifest.id,
			]);
			const current = row ? packageInstallation(row) : null;
			const pending = await tx.one(
				'SELECT 1 FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?',
				[userId, manifest.id],
			);
			admit(await this.identity(tx, digest), staged, key, current, pending !== null);
			const immutable = await tx.one(
				'SELECT * FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=?',
				[userId, manifest.id, manifest.version],
			);
			if (
				immutable &&
				(immutable.package_hash !== staged.packageHash || immutable.publisher_key_id !== staged.publisherKeyId)
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (
				current?.status === 'installed' &&
				current.package.version === manifest.version &&
				current.package.packageHash === staged.packageHash
			) {
				return current;
			}
			const references = await tx.one(
				"SELECT ref.app_id FROM agent_plugin_app_packages ref JOIN agent_plugin_installations i ON i.user_id=ref.user_id AND i.app_id=ref.app_id WHERE ref.user_id=? AND ref.package_id=? AND i.status<>'removed' LIMIT 1",
				[userId, manifest.id],
			);
			if (references) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (current) {
				assertRevisionAvailable(current.revision);
			}
			if (!immutable) {
				await tx.run('INSERT INTO agent_plugin_versions VALUES(?,?,?,?,?,?,?)', [
					userId,
					manifest.id,
					manifest.version,
					staged.packageHash,
					staged.publisherKeyId,
					stageId,
					JSON.stringify(manifest),
				]);
			}
			await tx.run(
				"INSERT INTO agent_plugin_packages VALUES(?,?,?,?,?,'installed',1,?,?) ON CONFLICT(user_id,package_id) DO UPDATE SET version=excluded.version,package_hash=excluded.package_hash,publisher_key_id=excluded.publisher_key_id,status='installed',revision=revision+1,updated_at=excluded.updated_at",
				[userId, manifest.id, manifest.version, staged.packageHash, staged.publisherKeyId, now, now],
			);
			assertRevisionAvailable(staged.version);
			await tx.run(
				"UPDATE agent_plugin_stages SET status='installed',version=version+1,updated_at=? WHERE id=? AND user_id=?",
				[now, stageId, userId],
			);
			const installed = await tx.one('SELECT * FROM agent_plugin_packages WHERE user_id=? AND package_id=?', [
				userId,
				manifest.id,
			]);
			if (!installed) {
				throw new Error('Installed package missing');
			}
			return packageInstallation(installed);
		});
	}

	composeApp(...args: Parameters<PluginStorage['composeApp']>): ReturnType<PluginStorage['composeApp']> {
		const [userId, digest, appId, packageId, expectedBinding, now, admit] = args;
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				"SELECT p.*,v.manifest_json FROM agent_plugin_packages p JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version WHERE p.user_id=? AND p.status='installed' ORDER BY p.package_id",
				[userId],
			);
			const trusted = await publishers(tx, userId);
			const candidates: StoredPluginCompositionCandidate[] = rows.map((row) => {
				if (typeof row.manifest_json !== 'string') {
					throw new Error('Package manifest missing');
				}
				return {
					installation: packageInstallation(row),
					manifest: pluginManifest(JSON.parse(row.manifest_json)),
					publisher: trusted.find((item) => item.keyId === row.publisher_key_id) ?? null,
				};
			});
			const decision = admit(await this.identity(tx, digest), candidates);
			if (decision.app.packageId !== packageId) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const existing = await readAppBinding(tx, userId, appId);
			const previous = await tx.one('SELECT * FROM agent_plugin_installations WHERE user_id=? AND app_id=?', [
				userId,
				appId,
			]);
			const restoring = previous?.status === 'removed';
			if (restoring) {
				if (
					previous.definition_id !== packageId ||
					previous.publisher_key_id !== decision.app.publisherKeyId ||
					!existing
				) {
					throw new PluginStorageRefusal('version_conflict');
				}
				const runtime = await tx.one(
					"SELECT 1 FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND state<>'closed' LIMIT 1",
					[userId, appId],
				);
				if (runtime) {
					throw new PluginRuntimeFenceRefusal();
				}
				assertRevisionAvailable(pluginInstallationRow(previous).revision);
				assertRevisionAvailable(existing.executionRevision);
				assertRevisionAvailable(existing.uiRevision);
			}
			const replacing = existing !== null && !restoring && expectedBinding !== null;
			if (
				expectedBinding !== null &&
				(!existing ||
					restoring ||
					existing.executionRevision !== expectedBinding.executionRevision ||
					existing.uiRevision !== expectedBinding.uiRevision)
			) {
				throw new PluginStorageRefusal('version_conflict');
			}
			if (existing && !restoring) {
				const matches = (left: typeof decision.app, right: typeof decision.app) =>
					left.packageId === right.packageId &&
					left.version === right.version &&
					left.packageHash === right.packageHash &&
					left.publisherKeyId === right.publisherKeyId;

				const changed =
					!matches(existing.app, decision.app) ||
					existing.selectedRootIds.length !== decision.selectedRootIds.length ||
					!existing.selectedRootIds.every((id) => decision.selectedRootIds.includes(id)) ||
					existing.dependencies.length !== decision.dependencies.length ||
					!existing.dependencies.every((item) =>
						decision.dependencies.some((candidate) => matches(item, candidate)),
					) ||
					(existing.ui === null
						? decision.ui !== null
						: decision.ui === null || !matches(existing.ui, decision.ui));
				if (changed && !replacing) {
					throw new PluginStorageRefusal('version_conflict');
				}
				if (!changed) {
					await ensurePluginInstances(tx, userId, existing, candidates, now);
					return existing;
				}
				if (!matches(existing.app, decision.app)) {
					throw new PluginStorageRefusal('version_conflict');
				}
				assertRevisionAvailable(existing.executionRevision);
				assertRevisionAvailable(existing.uiRevision);
			}
			const app = candidates.find((item) => item.installation.package.packageId === packageId);
			if (!app || !this.activation) {
				throw new PluginStorageRefusal('not_found');
			}
			const allReferences = [decision.app, ...decision.dependencies, ...(decision.ui ? [decision.ui] : [])];
			for (const reference of allReferences) {
				const candidate = candidates.find(
					(item) => item.installation.package.packageId === reference.packageId,
				);
				if (
					!candidate ||
					candidate.installation.package.version !== reference.version ||
					candidate.installation.package.packageHash !== reference.packageHash ||
					candidate.installation.package.publisherKeyId !== reference.publisherKeyId
				) {
					throw new PluginStorageRefusal('version_conflict');
				}
			}
			await this.activation(tx, {
				mode: replacing ? 'selection' : 'install',
				executionPackages: [
					{
						packageId: decision.app.packageId,
						kind: 'app',
						version: decision.app.version,
						packageHash: decision.app.packageHash,
						publisherKeyId: decision.app.publisherKeyId,
					},
					...decision.dependencies.map((reference) => ({
						packageId: reference.packageId,
						kind: 'tool' as const,
						version: reference.version,
						packageHash: reference.packageHash,
						publisherKeyId: reference.publisherKeyId,
					})),
				],
				userId,
				appId,
				definitionId: packageId,
				definitionVersion: app.manifest.version,
				displayName: app.manifest.displayName,
				contentHash: app.installation.package.packageHash,
				capabilities: [
					...new Set(
						candidates
							.filter((item) =>
								[decision.app, ...decision.dependencies].some(
									(reference) => reference.packageId === item.manifest.id,
								),
							)
							.flatMap((item) => item.manifest.capabilities),
					),
				],
				enabled: replacing
					? (await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]))
							?.enabled === 1
					: decision.initialization.enabled,
				grantedCapabilities: decision.initialization.grantedCapabilities,
				now,
			});
			const reference = decision.app;
			await tx.run(
				"INSERT INTO agent_plugin_installations VALUES(?,?,?,?,?,?,'installed',1,?,?) ON CONFLICT(user_id,app_id) DO UPDATE SET definition_id=excluded.definition_id,version=excluded.version,package_hash=excluded.package_hash,publisher_key_id=excluded.publisher_key_id,status='installed',revision=agent_plugin_installations.revision+1,updated_at=excluded.updated_at",
				[
					userId,
					appId,
					packageId,
					reference.version,
					reference.packageHash,
					reference.publisherKeyId,
					now,
					now,
				],
			);
			const binding: StoredPluginAppBinding = {
				appId,
				executionRevision: (restoring || replacing) && existing ? existing.executionRevision + 1 : 1,
				uiRevision: (restoring || replacing) && existing ? existing.uiRevision + 1 : 1,
				app: decision.app,
				selectedRootIds: decision.selectedRootIds.map((id) => id),
				dependencies: decision.dependencies,
				ui: decision.ui,
			};
			if (restoring || replacing) {
				await tx.run('DELETE FROM agent_plugin_app_packages WHERE user_id=? AND app_id=?', [userId, appId]);
				await tx.run(
					'UPDATE agent_plugin_app_bindings SET execution_revision=?,ui_revision=? WHERE user_id=? AND app_id=?',
					[binding.executionRevision, binding.uiRevision, userId, appId],
				);
				await writeAppPackageReferences(tx, userId, binding);
			} else {
				await writeAppBinding(tx, userId, binding);
			}
			await ensurePluginInstances(tx, userId, binding, candidates, now);
			return binding;
		});
	}

	appBinding(userId: number, appId: string): Promise<StoredPluginAppBinding> {
		return this.db.transaction(async (tx) => {
			const binding = await readAppBinding(tx, userId, appId);
			if (!binding) {
				throw new PluginStorageRefusal('not_found');
			}
			return binding;
		});
	}

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
		const retirement = await tx.one(
			'SELECT p.stage_id FROM agent_plugin_package_updates p JOIN agent_plugin_app_packages ref ON ref.user_id=p.user_id AND ref.package_id=p.package_id WHERE ref.user_id=? AND ref.app_id=? LIMIT 1',
			[userId, appId],
		);
		const runtime = await tx.one(
			"SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND state<>'closed' LIMIT 1",
			[userId, appId],
		);
		admit(await this.identity(tx, digest), current, runtime === null, typeof retirement?.stage_id === 'string');
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
		namespace?: string,
	): Promise<StoredPluginDataSnapshot> {
		return this.db.transaction(async (tx) => {
			const current = await this.migrationAuthority(tx, userId, digest, appId, admit);
			const items = await readPluginDataSnapshot(tx, userId, appId, namespace);
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
	): Promise<StoredPluginDataMigrationResult> {
		return this.db.transaction(async (tx) => {
			await this.migrationAuthority(tx, userId, digest, appId, admit);
			const result = await migratePluginData(tx, userId, appId, input);
			await this.migrationAuthority(tx, userId, digest, appId, admit);
			return result;
		});
	}

	async assertRuntimeClosed(userId: number, appId: string): Promise<void> {
		const row = await this.db.one(
			"SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND state<>'closed' LIMIT 1",
			[userId, appId],
		);
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
					? await tx.one(
							"SELECT * FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? ORDER BY CASE state WHEN 'unknown' THEN 0 WHEN 'opening' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,updated_at DESC,package_id LIMIT 1",
							[userId, appId],
						)
					: await tx.one(
							'SELECT app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND instance_id=? UNION ALL SELECT app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at FROM agent_plugin_runtime_history WHERE user_id=? AND app_id=? AND instance_id=?',
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
			const row = await tx.one(
				'SELECT * FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND instance_id=?',
				[userId, appId, instanceId],
			);
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
		historyLimit: number,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const { current } = await this.runtimeAuthority(tx, input.userId, input.appId, admit, input.packageId);
			const logical = await tx.one(
				`SELECT id FROM agent_plugin_instances WHERE user_id=? AND app_id=? AND id=?
			 AND package_id=? AND enabled=1 AND configuration_revision=?`,
				[input.userId, input.appId, input.logicalInstanceId, input.packageId, input.configurationRevision],
			);
			if (!logical || current.revision !== input.revision || current.status !== 'installed') {
				throw new PluginStorageRefusal('version_conflict');
			}
			const existing = await tx.one(
				'SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND logical_instance_id=?',
				[input.userId, input.appId, input.logicalInstanceId],
			);
			if (existing && existing.state !== 'closed') {
				throw new PluginRuntimeFenceRefusal();
			}
			if (existing) {
				await tx.run(
					`INSERT INTO agent_plugin_runtime_history(user_id,app_id,instance_id,revision,state,updated_at,unknown_at,
				 acknowledged_at,package_id,logical_instance_id,generation,configuration_revision)
				 SELECT user_id,app_id,instance_id,revision,state,updated_at,unknown_at,acknowledged_at,package_id,
				 logical_instance_id,generation,configuration_revision FROM agent_plugin_runtime_instances
				 WHERE user_id=? AND app_id=? AND logical_instance_id=?`,
					[input.userId, input.appId, input.logicalInstanceId],
				);
			}
			await tx.run(
				`DELETE FROM agent_plugin_runtime_history WHERE user_id=? AND app_id=? AND logical_instance_id=?
			 AND state='closed' AND unknown_at IS NULL AND instance_id NOT IN (SELECT instance_id FROM agent_plugin_runtime_history
			 WHERE user_id=? AND app_id=? AND logical_instance_id=? AND state='closed' AND unknown_at IS NULL
			 ORDER BY updated_at DESC,instance_id DESC LIMIT ?)`,
				[
					input.userId,
					input.appId,
					input.logicalInstanceId,
					input.userId,
					input.appId,
					input.logicalInstanceId,
					historyLimit,
				],
			);
			await tx.run(
				`INSERT INTO agent_plugin_runtime_instances(user_id,app_id,package_id,logical_instance_id,instance_id,
			 generation,revision,configuration_revision,state,updated_at) VALUES(?,?,?,?,?,?,?,?,'opening',?)
			 ON CONFLICT(user_id,app_id,logical_instance_id) DO UPDATE SET instance_id=excluded.instance_id,generation=excluded.generation,
			 revision=excluded.revision,configuration_revision=excluded.configuration_revision,state='opening',updated_at=excluded.updated_at,
			 unknown_at=NULL,acknowledged_at=NULL`,
				[
					input.userId,
					input.appId,
					input.packageId,
					input.logicalInstanceId,
					input.instanceId,
					input.generation,
					input.revision,
					input.configurationRevision,
					input.now,
				],
			);
		});
	}

	settleRuntime(input: StoredPluginRuntimeLease, state: 'active' | 'closed' | 'unknown'): Promise<void> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT state FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND package_id=? AND instance_id=? AND revision=? AND logical_instance_id=? AND generation=? AND configuration_revision=?',
				[
					input.userId,
					input.appId,
					input.packageId,
					input.instanceId,
					input.revision,
					input.logicalInstanceId,
					input.generation,
					input.configurationRevision,
				],
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
				"UPDATE agent_plugin_runtime_instances SET state=?,updated_at=?,unknown_at=CASE WHEN ?='unknown' THEN ? ELSE unknown_at END WHERE user_id=? AND app_id=? AND package_id=? AND instance_id=? AND revision=? AND logical_instance_id=? AND generation=? AND configuration_revision=?",
				[
					state,
					input.now,
					state,
					input.now,
					input.userId,
					input.appId,
					input.packageId,
					input.instanceId,
					input.revision,
					input.logicalInstanceId,
					input.generation,
					input.configurationRevision,
				],
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
		decide: (currentRevision: number) => void,
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
			decide(current.revision);
			assertRevisionAvailable(current.revision);
			const binding = await readAppBinding(tx, userId, appId);
			if (binding) {
				assertRevisionAvailable(binding.executionRevision);
				assertRevisionAvailable(binding.uiRevision);
			}
			const exhausted = await tx.one(
				'SELECT key FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL AND version>=? LIMIT 1',
				[userId, appId, Number.MAX_SAFE_INTEGER],
			);
			if (exhausted) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const live = await tx.one(
				'SELECT (SELECT COUNT(*) FROM agent_plugin_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL)+(SELECT COUNT(*) FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL) AS count',
				[userId, appId, userId, appId],
			);
			if (typeof live?.count !== 'number') {
				throw new Error('Plugin data count missing');
			}
			await tx.run(
				'UPDATE agent_plugin_data SET value_json=NULL,version=version+1,updated_at=? WHERE user_id=? AND app_id=? AND value_json IS NOT NULL',
				[now, userId, appId],
			);
			const extensionExhausted = await tx.one(
				'SELECT 1 FROM agent_plugin_extension_data WHERE user_id=? AND app_id=? AND value_json IS NOT NULL AND version>=? LIMIT 1',
				[userId, appId, Number.MAX_SAFE_INTEGER],
			);
			if (extensionExhausted) {
				throw new PluginStorageRefusal('version_conflict');
			}
			await tx.run(
				'UPDATE agent_plugin_extension_data SET value_json=NULL,version=version+1,updated_at=? WHERE user_id=? AND app_id=? AND value_json IS NOT NULL',
				[now, userId, appId],
			);
			await tx.run(
				'UPDATE agent_plugin_extension_operations SET value_json=NULL,retired=1 WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			await tx.run(
				'UPDATE agent_plugin_data_operations SET value_json=NULL,retired=1 WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			if (!this.configuration) {
				throw new Error('Plugin configuration cleanup unavailable');
			}
			await this.configuration.clear(tx, userId, appId);
			await clearPluginInstanceSettings(tx, userId, { kind: 'app', appId }, now);
			await tx.run(
				'UPDATE agent_plugin_installations SET revision=revision+1,updated_at=? WHERE user_id=? AND app_id=?',
				[now, userId, appId],
			);
			await tx.run(
				'UPDATE agent_plugin_app_bindings SET execution_revision=execution_revision+1,ui_revision=ui_revision+1 WHERE user_id=? AND app_id=?',
				[userId, appId],
			);
			const privateKeys = await clearPluginPrivateData(tx, userId, { kind: 'app', appId }, now);
			const result = { revision: current.revision + 1, deletedKeys: live.count + privateKeys, updatedAt: now };
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

	private async frontendInstallation(
		tx: SqlExecutor,
		userId: number,
		appId: string,
	): Promise<StoredPluginInstallation> {
		const current = await this.installation(tx, userId, appId);
		const binding = await readAppBinding(tx, userId, appId);
		if (!binding?.ui) {
			throw new PluginStorageRefusal('not_found');
		}
		const ui = binding.ui;
		const source = await tx.one(
			"SELECT p.* FROM agent_plugin_packages p WHERE p.user_id=? AND p.package_id=? AND p.version=? AND p.package_hash=? AND p.publisher_key_id=? AND p.status='installed'",
			[userId, ui.packageId, ui.version, ui.packageHash, ui.publisherKeyId],
		);
		const appPublisher = await tx.one(
			'SELECT revoked_at FROM agent_plugin_publishers WHERE user_id=? AND key_id=?',
			[userId, current.publisherKeyId],
		);
		if (!source || !appPublisher || appPublisher.revoked_at !== null) {
			throw new PluginStorageRefusal('version_conflict');
		}
		return {
			appId,
			definitionId: ui.packageId,
			version: ui.version,
			packageHash: ui.packageHash,
			publisherKeyId: ui.publisherKeyId,
			status: current.status,
			revision: binding.uiRevision,
			createdAt: current.createdAt,
			updatedAt: current.updatedAt,
		};
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
	): Promise<StoredPluginInstallation> {
		const current = await this.frontendInstallation(tx, userId, appId);
		const key = (await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null;
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
		if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
			throw new Error('Corrupt plugin App');
		}
		admit(await this.identity(tx, digest), current, key, app.enabled === 1);
		return current;
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
		return this.db.withTransactionAdmission(async (tx) => {
			await this.dataAuthority(tx, userId, digest, appId, admit);
		}, work);
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
		const current = await this.frontendInstallation(tx, userId, appId);
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
		packageId?: string,
	): Promise<StoredPluginData | null> {
		return this.db.transaction(async (tx) => {
			const ui = await this.dataAuthority(tx, userId, digest, appId, admit);
			if (packageId !== undefined && packageId !== ui.definitionId) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const current = await this.installation(tx, userId, appId);
			const result =
				ui.definitionId !== current.definitionId
					? await readPluginExtensionData(tx, userId, appId, ui.definitionId, key)
					: await readPluginData(tx, userId, appId, key);
			await this.dataAuthority(tx, userId, digest, appId, admit);
			return result;
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
		decide: (current: StoredPluginData | null) => void,
		packageId?: string,
	): Promise<StoredPluginData> {
		return this.db.transaction(async (tx) => {
			const ui = await this.dataAuthority(tx, userId, digest, appId, admit);
			if (packageId !== undefined && packageId !== ui.definitionId) {
				throw new PluginStorageRefusal('version_conflict');
			}
			const current = await this.installation(tx, userId, appId);
			const result =
				ui.definitionId !== current.definitionId
					? await mutatePluginExtensionData(tx, userId, appId, ui.definitionId, input, decide)
					: await mutatePluginData(tx, userId, appId, input, decide);
			await this.dataAuthority(tx, userId, digest, appId, admit);
			return result;
		});
	}

	async versions(userId: number): Promise<StoredPluginVersion[]> {
		const rows = await this.db.all(
			"SELECT v.definition_id,v.version,v.manifest_json,v.package_hash,v.publisher_key_id FROM agent_plugin_versions v WHERE v.user_id=? AND json_extract(v.manifest_json,'$.schemaVersion')=? AND (EXISTS(SELECT 1 FROM agent_plugin_packages p WHERE p.user_id=v.user_id AND p.package_id=v.definition_id AND p.version=v.version AND p.package_hash=v.package_hash AND p.publisher_key_id=v.publisher_key_id AND p.status IN ('installed','draining','removed')) OR EXISTS(SELECT 1 FROM agent_plugin_app_packages ref WHERE ref.user_id=v.user_id AND ref.package_id=v.definition_id AND ref.version=v.version AND ref.package_hash=v.package_hash AND ref.publisher_key_id=v.publisher_key_id)) ORDER BY v.definition_id,v.version",
			[userId, AGENT_PLUGIN_MANIFEST_SCHEMA_VERSION],
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
		settingsInstanceId?: string,
	): Promise<StoredPluginContentSource> {
		return this.db.transaction(async (tx) => {
			let current: StoredPluginInstallation;
			if (settingsInstanceId === undefined) {
				current = await this.frontendInstallation(tx, userId, appId);
			} else {
				try {
					const source = await readPluginInstanceSource(tx, userId, appId, settingsInstanceId);
					current = {
						appId,
						definitionId: source.package.packageId,
						version: source.package.version,
						packageHash: source.package.packageHash,
						publisherKeyId: source.package.publisherKeyId,
						status: 'installed',
						revision: source.packageRevision,
						createdAt: source.instance.createdAt,
						updatedAt: source.instance.updatedAt,
					};
				} catch (error) {
					if (
						error instanceof PluginInstanceRefusal &&
						(error.code === 'not_found' || error.code === 'version_conflict')
					) {
						throw new PluginStorageRefusal(error.code);
					}
					throw error;
				}
			}
			const key = (await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null;
			const app = await tx.one('SELECT enabled FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
			if (!app || (app.enabled !== 0 && app.enabled !== 1)) {
				throw new Error('Corrupt plugin App');
			}
			admit(await this.identity(tx, digest), current, key, app.enabled === 1);
			if (current.version !== version || !key) {
				throw new PluginStorageRefusal('version_conflict');
			}
			return this.packageSource(tx, userId, current, key);
		});
	}

	private async packageSource(
		tx: SqlExecutor,
		userId: number,
		current: StoredPluginInstallation,
		key: StoredPluginPublisher,
	): Promise<StoredPluginContentSource> {
		const version = current.version;
		const immutable = await tx.one(
			'SELECT stage_id,package_hash,publisher_key_id FROM agent_plugin_versions WHERE user_id=? AND definition_id=? AND version=?',
			[userId, current.definitionId, version],
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
			"SELECT DISTINCT i.user_id,i.app_id FROM agent_plugin_installations i JOIN agent_apps a ON a.user_id=i.user_id AND a.id=i.app_id WHERE i.status=? AND a.enabled=1 AND NOT EXISTS(SELECT 1 FROM agent_plugin_runtime_instances r WHERE r.user_id=i.user_id AND r.app_id=i.app_id AND r.state='unknown')",
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
		packageId?: string,
	): Promise<{ current: StoredPluginInstallation; key: StoredPluginPublisher | null }> {
		const current = await this.installation(tx, userId, appId, packageId);
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
		packageId?: string,
	): Promise<StoredPluginContentSource> {
		return this.db.transaction(async (tx) => {
			const { current, key } = await this.runtimeAuthority(tx, userId, appId, admit, packageId);
			if (!key) {
				throw new PluginStorageRefusal('version_conflict');
			}
			return this.packageSource(tx, userId, current, key);
		});
	}

	runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<StoredPluginData | null> {
		return this.db.transaction(async (tx) => {
			await this.runtimeAuthority(tx, userId, appId, admit, packageId);
			const app = await this.installation(tx, userId, appId);
			const result =
				packageId && packageId !== app.definitionId
					? await readPluginExtensionData(tx, userId, appId, packageId, key)
					: await readPluginData(tx, userId, appId, key);
			await this.runtimeAuthority(tx, userId, appId, admit, packageId);
			return result;
		});
	}

	runtimeMutateData(
		userId: number,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		decide: (current: StoredPluginData | null) => void,
		packageId?: string,
	): Promise<StoredPluginData> {
		return this.db.transaction(async (tx) => {
			await this.runtimeAuthority(tx, userId, appId, admit, packageId);
			const app = await this.installation(tx, userId, appId);
			const result =
				packageId && packageId !== app.definitionId
					? await mutatePluginExtensionData(tx, userId, appId, packageId, input, decide)
					: await mutatePluginData(tx, userId, appId, input, decide);
			await this.runtimeAuthority(tx, userId, appId, admit, packageId);
			return result;
		});
	}

	private activation: ((tx: SqlExecutor, input: StoredPluginActivation) => Promise<void>) | null = null;
	private retirement: ((tx: SqlExecutor, userId: number, appId: string, now: number) => Promise<void>) | null = null;
	private configuration: PluginConfigurationLifecycle | null = null;

	installConfigurationLifecycle(configuration: PluginConfigurationLifecycle): void {
		if (this.configuration) {
			throw new Error('Plugin configuration lifecycle already installed');
		}
		this.configuration = configuration;
	}

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

	installationDirectory(userId: number): Promise<StoredPluginInstallationDirectory> {
		return this.db.transaction(async (tx) => {
			if (!this.configuration) {
				throw new Error('Plugin configuration lifecycle unavailable');
			}
			const installations = (
				await tx.all('SELECT * FROM agent_plugin_installations WHERE user_id=? ORDER BY definition_id', [
					userId,
				])
			).map(pluginInstallationRow);
			if (!installations.some((installation) => installation.status === 'removed')) {
				return { installations, retainedAppIds: [] };
			}
			const data = await tx.all(
				'SELECT DISTINCT app_id FROM agent_plugin_data WHERE user_id=? AND value_json IS NOT NULL UNION SELECT DISTINCT app_id FROM agent_plugin_extension_data WHERE user_id=? AND value_json IS NOT NULL UNION SELECT DISTINCT app_id FROM agent_plugin_private_data WHERE user_id=? AND document_json IS NOT NULL',
				[userId, userId, userId],
			);
			const retained = new Set(await this.configuration.retainedApps(tx, userId));
			for (const row of data) {
				if (typeof row.app_id !== 'string') {
					throw new Error('Invalid plugin data owner');
				}
				retained.add(row.app_id);
			}
			return {
				installations,
				retainedAppIds: installations
					.filter((installation) => installation.status === 'removed' && retained.has(installation.appId))
					.map((installation) => installation.appId),
			};
		});
	}

	private async installation(
		tx: SqlExecutor,
		userId: number,
		appId: string,
		packageId?: string,
	): Promise<StoredPluginInstallation> {
		if (packageId) {
			const row = await tx.one(
				`SELECT ref.package_id AS definition_id,ref.version,ref.package_hash,ref.publisher_key_id,
				 i.app_id,p.status,p.revision,i.created_at,i.updated_at
			 FROM agent_plugin_app_packages ref JOIN agent_plugin_app_bindings b ON b.user_id=ref.user_id AND b.app_id=ref.app_id
			 JOIN agent_plugin_installations i ON i.user_id=ref.user_id AND i.app_id=ref.app_id
			 JOIN agent_plugin_packages p ON p.user_id=ref.user_id AND p.package_id=ref.package_id
			 WHERE ref.user_id=? AND ref.app_id=? AND ref.package_id=? AND i.status='installed'
			 AND p.status IN ('installed','draining') AND p.version=ref.version AND p.package_hash=ref.package_hash AND p.publisher_key_id=ref.publisher_key_id LIMIT 1`,
				[userId, appId, packageId],
			);
			if (!row) {
				throw new PluginStorageRefusal('version_conflict');
			}
			return pluginInstallationRow(row);
		}
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
			assertRevisionAvailable(current.revision);
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
			const runtime = await tx.one(
				"SELECT 1 FROM agent_plugin_runtime_instances WHERE user_id=? AND app_id=? AND state<>'closed' LIMIT 1",
				[userId, appId],
			);
			if (runtime) {
				throw new PluginRuntimeFenceRefusal();
			}
			assertRevisionAvailable(current.revision);
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
			assertRevisionAvailable(current.revision);
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
			assertRevisionAvailable(row.version);
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
			const count = await tx.one(
				'SELECT COUNT(*) AS count FROM agent_plugin_publishers WHERE user_id=? AND revoked_at IS NULL',
				[userId],
			);
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
			assertRevisionAvailable(current.version);
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
		admit: (identity: number | null) => void,
	): Promise<StoredPluginStage> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
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

	reusableStage(
		userId: number,
		digest: string,
		packageHash: string,
		admit: (
			identity: number | null,
			current: StoredPluginStage | null,
			publisher: StoredPluginPublisher | null,
		) => void,
	): Promise<StoredPluginStage | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT s.* FROM agent_plugin_stages s WHERE s.user_id=? AND s.package_hash=?
				 AND s.status IN ('verified','installed') ORDER BY
				 EXISTS(SELECT 1 FROM agent_plugin_retirements r WHERE r.stage_id=s.id) DESC,
				 s.updated_at DESC,s.id DESC LIMIT 1`,
				[userId, packageHash],
			);
			const current = row === null ? null : stageRow(row);
			const publisher =
				current === null
					? null
					: ((await publishers(tx, userId)).find((item) => item.keyId === current.publisherKeyId) ?? null);
			admit(await this.identity(tx, digest), current, publisher);
			return current;
		});
	}

	claimStageCleanup(
		userId: number,
		digest: string,
		retain: number,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginStage[]> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const rows = await tx.all(
				`SELECT s.* FROM agent_plugin_stages s WHERE s.user_id=? AND s.status!='staging'
				 AND NOT EXISTS(SELECT 1 FROM agent_plugin_versions v WHERE v.stage_id=s.id)
				 AND NOT EXISTS(SELECT 1 FROM agent_plugin_retirements r WHERE r.stage_id=s.id) AND NOT EXISTS(SELECT 1 FROM agent_plugin_package_updates p WHERE p.stage_id=s.id)
				 ORDER BY s.updated_at DESC,s.id DESC LIMIT -1 OFFSET ?`,
				[userId, retain],
			);
			const result: StoredPluginStage[] = [];
			for (const row of rows) {
				const current = stageRow(row);
				assertRevisionAvailable(current.version);
				await tx.run(
					"UPDATE agent_plugin_stages SET status='failed',version=version+1,manifest_json=NULL,publisher_key_id=NULL WHERE id=?",
					[current.id],
				);
				result.push({
					id: current.id,
					packageHash: current.packageHash,
					sizeBytes: current.sizeBytes,
					status: 'failed',
					version: current.version + 1,
					publisherKeyId: null,
					manifest: null,
					createdAt: current.createdAt,
					updatedAt: current.updatedAt,
				});
			}
			return result;
		});
	}

	finishStageCleanup(userId: number, id: string, version: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				`DELETE FROM agent_plugin_stages WHERE user_id=? AND id=? AND version=? AND status='failed'
				 AND NOT EXISTS(SELECT 1 FROM agent_plugin_versions WHERE stage_id=?)
				 AND NOT EXISTS(SELECT 1 FROM agent_plugin_retirements WHERE stage_id=?) AND NOT EXISTS(SELECT 1 FROM agent_plugin_package_updates WHERE stage_id=?)`,
				[userId, id, version, id, id, id],
			);
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
			assertRevisionAvailable(current.version);
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

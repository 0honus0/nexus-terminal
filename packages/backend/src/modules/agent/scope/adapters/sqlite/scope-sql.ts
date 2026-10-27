import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { initializeAppPolicy, invalidateAppPolicy } from '../../../governance/adapters/sqlite/policy-write.js';
import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';
import { readApp, readDefinition, assertAppRevisionAvailable } from './app-row.js';
import { AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentScopeStorage,
	CreateAppRecord,
	CreateThreadRecord,
	AppRecord,
	ThreadRecord,
	StoredDefinition,
	StoredAppInstallationFact,
	StoredAppInstallationTask,
} from '../../storage/scope-storage.js';

async function getApp(tx: SqlExecutor, userId: number, id: string): Promise<AppRecord | null> {
	const row = await tx.one('SELECT * FROM agent_apps WHERE id=? AND user_id=?', [id, userId]);
	return row === null ? null : readApp(tx, row);
}

export class SqliteScopeStorage implements AgentScopeStorage {
	constructor(private readonly db: SqliteRuntime) {}

	listDeclarations(userId: number, limit: number): Promise<StoredDefinition[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				"SELECT d.* FROM agent_app_definitions d WHERE d.installed=1 AND (d.source_kind='builtin' OR EXISTS (SELECT 1 FROM agent_plugin_installations p WHERE p.user_id=? AND p.definition_id=d.id AND p.version=d.version AND p.status='installed')) ORDER BY d.id,d.version LIMIT ?",
				[userId, limit],
			);
			const values: StoredDefinition[] = [];
			for (const row of rows) {
				values.push(await readDefinition(tx, row));
			}
			return values;
		});
	}

	installDefinitions(
		definitions: StoredDefinition[],
		now: () => number,
		decide: (current: StoredAppInstallationFact) => StoredAppInstallationTask,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run("UPDATE agent_app_definitions SET installed=0 WHERE source_kind='builtin'");
			for (const definition of definitions) {
				const existing = await tx.one(
					'SELECT display_name,default_enabled,content_hash,source_kind FROM agent_app_definitions WHERE id=? AND version=?',
					[definition.id, definition.version],
				);
				if (existing !== null) {
					const caps = await tx.all(
						'SELECT capability FROM agent_app_declared_capabilities WHERE definition_id=? AND definition_version=? ORDER BY capability LIMIT ?',
						[definition.id, definition.version, AGENT_CAPABILITIES.length + 1],
					);
					if (
						existing.source_kind !== 'builtin' ||
						existing.content_hash !== definition.contentHash ||
						existing.display_name !== definition.displayName ||
						existing.default_enabled !== Number(definition.defaultEnabled) ||
						JSON.stringify(caps.map((row) => row.capability)) !==
							JSON.stringify([...definition.capabilities].sort())
					) {
						throw new Error('App declaration changed without a version');
					}
					await tx.run('UPDATE agent_app_definitions SET installed=1 WHERE id=? AND version=?', [
						definition.id,
						definition.version,
					]);
				} else {
					await tx.run(
						"INSERT INTO agent_app_definitions(id,version,display_name,content_hash,installed,default_enabled,source_kind) VALUES(?,?,?,?,1,?,'builtin')",
						[
							definition.id,
							definition.version,
							definition.displayName,
							definition.contentHash,
							Number(definition.defaultEnabled),
						],
					);
					for (const capability of definition.capabilities) {
						await tx.run(
							'INSERT INTO agent_app_declared_capabilities(definition_id,definition_version,capability) VALUES(?,?,?)',
							[definition.id, definition.version, capability],
						);
					}
				}
			}
			// A removed source is disabled; an upgrade preserves the user's enabled choice.
			let cursor = '';
			while (true) {
				const rows = await tx.all(
					"SELECT a.id,a.user_id,a.definition_id,a.definition_version,a.enabled,a.version FROM agent_apps a JOIN agent_app_definitions d ON d.id=a.definition_id AND d.version=a.definition_version WHERE d.source_kind='builtin' AND a.id>? ORDER BY a.id LIMIT 128",
					[cursor],
				);
				for (const row of rows) {
					if (
						typeof row.id !== 'string' ||
						typeof row.user_id !== 'number' ||
						!Number.isSafeInteger(row.user_id) ||
						row.user_id < 1
					) {
						throw new Error('Corrupt App installation identity');
					}
					cursor = row.id;
					if (
						typeof row.definition_id !== 'string' ||
						typeof row.definition_version !== 'string' ||
						(row.enabled !== 0 && row.enabled !== 1)
					) {
						throw new Error('Corrupt installed App reference');
					}
					const task = decide({
						definitionId: row.definition_id,
						definitionVersion: row.definition_version,
						enabled: row.enabled === 1,
					});
					if (!task.invalidate) {
						continue;
					}
					assertAppRevisionAvailable(row.version);
					const timestamp = now();
					await tx.run(
						'UPDATE agent_apps SET definition_version=?,enabled=?,version=version+1,updated_at=? WHERE id=?',
						[task.definitionVersion, Number(task.enabled), timestamp, row.id],
					);
					await invalidateAppPolicy(tx, row.user_id, row.id);
					await cancelRunsInScope(tx, row.user_id, row.id, timestamp);
				}
				if (rows.length < 128) {
					break;
				}
			}
		});
	}

	createApp(input: CreateAppRecord): Promise<AppRecord> {
		return this.db.transaction(async (tx) => {
			if (input.isDefault) {
				const row = await tx.one(
					'SELECT * FROM agent_apps WHERE user_id=? AND definition_id=? AND is_default=1',
					[input.userId, input.definitionId],
				);
				if (row !== null) {
					return readApp(tx, row);
				}
			}
			const definition = await tx.one(
				'SELECT 1 FROM agent_app_definitions WHERE id=? AND version=? AND installed=1',
				[input.definitionId, input.definitionVersion],
			);
			if (definition === null) {
				throw new Error('App definition is not installed');
			}
			await tx.run(
				'INSERT INTO agent_apps(id,user_id,name,created_at,definition_id,definition_version,enabled,version,updated_at,is_default) VALUES(?,?,?,?,?,?,?,1,?,?)',
				[
					input.id,
					input.userId,
					input.name,
					input.now,
					input.definitionId,
					input.definitionVersion,
					Number(input.enabled),
					input.now,
					Number(input.isDefault),
				],
			);
			await initializeAppPolicy(tx, input.userId, input.id, input.grants);
			const result = await getApp(tx, input.userId, input.id);
			if (result === null) {
				throw new Error('App disappeared on creation');
			}
			return result;
		});
	}

	getApp(userId: number, id: string): Promise<AppRecord | null> {
		return this.db.transaction((tx) => getApp(tx, userId, id));
	}

	listApps(userId: number, limit: number): Promise<AppRecord[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all('SELECT * FROM agent_apps WHERE user_id=? ORDER BY created_at,id LIMIT ?', [
				userId,
				limit,
			]);
			return Promise.all(rows.map((row) => readApp(tx, row)));
		});
	}

	setEnabled(
		userId: number,
		id: string,
		version: number,
		now: () => number,
		decide: (current: AppRecord) => { enabled: boolean; invalidate: boolean },
	): Promise<AppRecord | 'not_found' | 'version_conflict'> {
		return this.db.transaction(async (tx) => {
			const current = await getApp(tx, userId, id);
			if (current === null) {
				return 'not_found';
			}
			if (current.version !== version) {
				return 'version_conflict';
			}
			const task = decide(current);
			if (task.enabled === current.enabled && !task.invalidate) {
				return current;
			}
			assertAppRevisionAvailable(current.version);
			const timestamp = now();
			const result = await tx.run(
				'UPDATE agent_apps SET enabled=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?',
				[Number(task.enabled), timestamp, userId, id, version],
			);
			if (result.changes !== 1) {
				throw new Error('Lost App lifecycle CAS');
			}
			if (task.invalidate) {
				await invalidateAppPolicy(tx, userId, id);
				await cancelRunsInScope(tx, userId, id, timestamp);
			}
			const updated = await getApp(tx, userId, id);
			if (updated === null) {
				throw new Error('App disappeared on state change');
			}
			return updated;
		});
	}

	async createThread(
		input: CreateThreadRecord,
		admitCapacity: (threads: number) => void,
	): Promise<ThreadRecord | null> {
		return this.db.transaction(async (tx) => {
			const app = await getApp(tx, input.userId, input.appId);
			if (app === null) {
				return null;
			}
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_threads WHERE user_id=? AND app_id=?', [
				input.userId,
				input.appId,
			]);
			if (!count || typeof count.count !== 'number' || !Number.isSafeInteger(count.count) || count.count < 0) {
				throw new Error('Corrupt thread capacity');
			}
			admitCapacity(count.count);
			await tx.run(
				'INSERT INTO agent_threads(id,user_id,app_id,title,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',
				[input.id, input.userId, input.appId, input.title, input.createdAt, input.createdAt],
			);
			return {
				id: input.id,
				userId: input.userId,
				appId: input.appId,
				title: input.title,
				version: 1,
				createdAt: input.createdAt,
				updatedAt: input.createdAt,
			};
		});
	}
}

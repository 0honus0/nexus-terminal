import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { invalidateAppPolicy } from '../../../governance/adapters/sqlite/policy-write.js';
import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';
import { readApp, readDefinition, assertAppRevisionAvailable } from './app-row.js';
import type {
	AgentScopeStorage,
	CreateThreadRecord,
	AppRecord,
	ThreadRecord,
	StoredDefinition,
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
				"SELECT d.* FROM agent_app_definitions d WHERE EXISTS (SELECT 1 FROM agent_plugin_installations p WHERE p.user_id=? AND p.definition_id=d.id AND p.version=d.version AND p.status='installed') ORDER BY d.id,d.version LIMIT ?",
				[userId, limit],
			);
			const values: StoredDefinition[] = [];
			for (const row of rows) {
				values.push(await readDefinition(tx, row));
			}
			return values;
		});
	}

	getApp(userId: number, id: string): Promise<AppRecord | null> {
		return this.db.transaction((tx) => getApp(tx, userId, id));
	}

	listApps(userId: number, limit: number): Promise<AppRecord[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				"SELECT a.* FROM agent_apps a WHERE a.user_id=? AND NOT EXISTS (SELECT 1 FROM agent_plugin_installations p WHERE p.user_id=a.user_id AND p.app_id=a.id AND p.status='removed') ORDER BY a.created_at,a.id LIMIT ?",
				[userId, limit],
			);
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

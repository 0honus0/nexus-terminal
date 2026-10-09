import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	AgentScopeStorage,
	CreateAppRecord,
	CreateThreadRecord,
	AppRecord,
	ThreadRecord,
} from '../../storage/scope-storage.js';

export class SqliteScopeStorage implements AgentScopeStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async createApp(input: CreateAppRecord): Promise<AppRecord> {
		await this.db.run('INSERT INTO agent_apps(id,user_id,name,created_at) VALUES(?,?,?,?)', [
			input.id,
			input.userId,
			input.name,
			input.createdAt,
		]);
		return { id: input.id, userId: input.userId, name: input.name, createdAt: input.createdAt };
	}

	async createThread(input: CreateThreadRecord): Promise<ThreadRecord | null> {
		return this.db.transaction(async (tx) => {
			const app = await tx.one('SELECT id FROM agent_apps WHERE id=? AND user_id=?', [input.appId, input.userId]);
			if (app === null) {
				return null;
			}
			await tx.run('INSERT INTO agent_threads(id,user_id,app_id,title,created_at) VALUES(?,?,?,?,?)', [
				input.id,
				input.userId,
				input.appId,
				input.title,
				input.createdAt,
			]);
			return {
				id: input.id,
				userId: input.userId,
				appId: input.appId,
				title: input.title,
				createdAt: input.createdAt,
			};
		});
	}
}

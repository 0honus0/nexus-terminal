import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { CommandSort } from '@nexus-terminal/shared/preferences/commands/values';
import type {
	CommandStorage,
	StoredCommand,
	StoredCommandTag,
	StoredCommandTask,
	StoredCommandResult,
	CommandAuthorization,
} from '../../storage/command-storage.js';
import { commandRow, commandTagRow } from './command-row.js';

export class SqliteCommandStorage implements CommandStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Command identity already installed');
		}
		this.readIdentity = read;
	}

	private async readCommand(tx: SqlExecutor, userId: number, id: number): Promise<StoredCommand | null> {
		const row = await tx.one('SELECT * FROM preferences_commands WHERE user_id=? AND id=?', [userId, id]);
		if (!row) {
			return null;
		}
		const tags = await tx.all(
			'SELECT tag_id FROM preferences_command_associations WHERE user_id=? AND command_id=? ORDER BY tag_id',
			[userId, id],
		);
		return commandRow(row, tags);
	}

	list(userId: number, sortBy: CommandSort, offset: number, limit: number): Promise<StoredCommand[]> {
		return this.db.transaction(async (tx) => {
			const order = sortBy === 'usageCount' ? 'usage_count DESC,name ASC,id ASC' : 'name ASC,id ASC';
			const rows = await tx.all(
				`SELECT * FROM preferences_commands WHERE user_id=? ORDER BY ${order} LIMIT ? OFFSET ?`,
				[userId, limit, offset],
			);
			const ids = rows.map((row) => {
				if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1) {
					throw new Error('Corrupt command identity');
				}
				return row.id;
			});
			if (!ids.length) {
				return [];
			}
			const links = await tx.all(
				`SELECT command_id,tag_id FROM preferences_command_associations WHERE user_id=? AND command_id IN (${ids.map(() => '?').join(',')}) ORDER BY command_id,tag_id`,
				[userId, ...ids],
			);
			const result = rows.map((row) =>
				commandRow(
					row,
					links.filter((link) => link.command_id === row.id),
				),
			);

			return result;
		});
	}

	async listTags(userId: number, offset: number, limit: number): Promise<StoredCommandTag[]> {
		return (
			await this.db.all(
				'SELECT * FROM preferences_command_tags WHERE user_id=? ORDER BY name ASC,id ASC LIMIT ? OFFSET ?',
				[userId, limit, offset],
			)
		).map(commandTagRow);
	}

	private async count(tx: SqlExecutor, userId: number, collection: 'commands' | 'tags'): Promise<number> {
		const table = collection === 'commands' ? 'preferences_commands' : 'preferences_command_tags';
		const row = await tx.one(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`, [userId]);
		if (!row || typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0) {
			throw new Error('Corrupt command count');
		}
		return row.count;
	}

	private async hasTags(tx: SqlExecutor, userId: number, ids: readonly number[]): Promise<boolean> {
		if (!ids.length) {
			return true;
		}
		const rows = await tx.all(
			`SELECT id FROM preferences_command_tags WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`,
			[userId, ...ids],
		);
		return rows.length === ids.length;
	}

	private async replaceTags(tx: SqlExecutor, userId: number, id: number, ids: readonly number[]): Promise<void> {
		await tx.run('DELETE FROM preferences_command_associations WHERE user_id=? AND command_id=?', [userId, id]);
		for (const tagId of ids) {
			await tx.run('INSERT INTO preferences_command_associations(user_id,command_id,tag_id) VALUES(?,?,?)', [
				userId,
				id,
				tagId,
			]);
		}
	}

	mutate(
		userId: number,
		task: StoredCommandTask,
		at: number,
		authorization: CommandAuthorization,
	): Promise<StoredCommandResult> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Command identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			switch (task.action) {
				case 'create':
				case 'update':
					return this.writeCommand(tx, userId, task, at, authorization);
				case 'delete':
				case 'increment':
					return this.changeCommand(tx, userId, task, at);
				case 'create_tag':
				case 'update_tag':
					return this.writeTag(tx, userId, task, at, authorization);
				case 'delete_tag':
					return this.deleteTag(tx, userId, task, at);
				case 'assign_tag':
					return this.assignTag(tx, userId, task, at, authorization);
			}
		});
	}

	private async writeCommand(
		tx: SqlExecutor,
		userId: number,
		task: Extract<StoredCommandTask, { action: 'create' | 'update' }>,
		at: number,
		authorization: CommandAuthorization,
	): Promise<StoredCommandResult> {
		if (!(await this.hasTags(tx, userId, task.input.tagIds))) {
			return { status: 'not_found' };
		}
		let id: number;
		if (task.action === 'create') {
			authorization.admitCount('commands', await this.count(tx, userId, 'commands'));
			const saved = await tx.run(
				'INSERT INTO preferences_commands(user_id,version,name,command,variables_json,created_at,updated_at) VALUES(?,1,?,?,?,?,?)',
				[userId, task.input.name, task.input.command, JSON.stringify(task.input.variables), at, at],
			);
			id = saved.lastId;
		} else {
			const current = await this.readCommand(tx, userId, task.id);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.version !== task.expectedVersion) {
				return { status: 'version_conflict' };
			}
			id = task.id;
			await tx.run(
				'UPDATE preferences_commands SET version=version+1,name=?,command=?,variables_json=?,updated_at=? WHERE user_id=? AND id=?',
				[task.input.name, task.input.command, JSON.stringify(task.input.variables), at, userId, id],
			);
		}
		await this.replaceTags(tx, userId, id, task.input.tagIds);
		const value = await this.readCommand(tx, userId, id);
		if (!value) {
			throw new Error('Missing command after write');
		}
		return { status: 'command', value };
	}

	private async changeCommand(
		tx: SqlExecutor,
		userId: number,
		task: Extract<StoredCommandTask, { action: 'delete' | 'increment' }>,
		at: number,
	): Promise<StoredCommandResult> {
		const current = await this.readCommand(tx, userId, task.id);
		if (!current) {
			return { status: 'not_found' };
		}
		if (current.version !== task.expectedVersion) {
			return { status: 'version_conflict' };
		}
		if (task.action === 'delete') {
			await tx.run('DELETE FROM preferences_commands WHERE user_id=? AND id=?', [userId, task.id]);
			return { status: 'deleted' };
		}
		if (current.usageCount >= Number.MAX_SAFE_INTEGER) {
			return { status: 'limit_exceeded' };
		}
		await tx.run(
			'UPDATE preferences_commands SET version=version+1,usage_count=usage_count+1,updated_at=? WHERE user_id=? AND id=?',
			[at, userId, task.id],
		);
		const value = await this.readCommand(tx, userId, task.id);
		if (!value) {
			throw new Error('Missing command after increment');
		}
		return { status: 'command', value };
	}

	private async writeTag(
		tx: SqlExecutor,
		userId: number,
		task: Extract<StoredCommandTask, { action: 'create_tag' | 'update_tag' }>,
		at: number,
		authorization: CommandAuthorization,
	): Promise<StoredCommandResult> {
		let id: number;
		if (task.action === 'update_tag') {
			const row = await tx.one('SELECT * FROM preferences_command_tags WHERE user_id=? AND id=?', [
				userId,
				task.id,
			]);
			if (!row) {
				return { status: 'not_found' };
			}
			if (commandTagRow(row).version !== task.expectedVersion) {
				return { status: 'version_conflict' };
			}
			id = task.id;
		} else {
			authorization.admitCount('tags', await this.count(tx, userId, 'tags'));
			id = 0;
		}
		const duplicate = await tx.one('SELECT id FROM preferences_command_tags WHERE user_id=? AND name=? AND id<>?', [
			userId,
			task.name,
			id,
		]);
		if (duplicate) {
			return { status: 'name_conflict' };
		}
		if (task.action === 'create_tag') {
			id = (
				await tx.run(
					'INSERT INTO preferences_command_tags(user_id,version,name,created_at,updated_at) VALUES(?,1,?,?,?)',
					[userId, task.name, at, at],
				)
			).lastId;
		} else {
			await tx.run(
				'UPDATE preferences_command_tags SET version=version+1,name=?,updated_at=? WHERE user_id=? AND id=?',
				[task.name, at, userId, id],
			);
		}
		const row = await tx.one('SELECT * FROM preferences_command_tags WHERE user_id=? AND id=?', [userId, id]);
		if (!row) {
			throw new Error('Missing tag after write');
		}
		return { status: 'tag', value: commandTagRow(row) };
	}

	private async deleteTag(
		tx: SqlExecutor,
		userId: number,
		task: Extract<StoredCommandTask, { action: 'delete_tag' }>,
		at: number,
	): Promise<StoredCommandResult> {
		const row = await tx.one('SELECT * FROM preferences_command_tags WHERE user_id=? AND id=?', [userId, task.id]);
		if (!row) {
			return { status: 'not_found' };
		}
		if (commandTagRow(row).version !== task.expectedVersion) {
			return { status: 'version_conflict' };
		}
		const saturated = await tx.one(
			'SELECT id FROM preferences_commands WHERE user_id=? AND version>=? AND id IN (SELECT command_id FROM preferences_command_associations WHERE user_id=? AND tag_id=?) LIMIT 1',
			[userId, Number.MAX_SAFE_INTEGER, userId, task.id],
		);
		if (saturated) {
			return { status: 'limit_exceeded' };
		}
		await tx.run(
			'UPDATE preferences_commands SET version=version+1,updated_at=? WHERE user_id=? AND id IN (SELECT command_id FROM preferences_command_associations WHERE user_id=? AND tag_id=?)',
			[at, userId, userId, task.id],
		);
		await tx.run('DELETE FROM preferences_command_tags WHERE user_id=? AND id=?', [userId, task.id]);
		return { status: 'deleted' };
	}

	private async assignTag(
		tx: SqlExecutor,
		userId: number,
		task: Extract<StoredCommandTask, { action: 'assign_tag' }>,
		at: number,
		authorization: CommandAuthorization,
	): Promise<StoredCommandResult> {
		if (!(await this.hasTags(tx, userId, [task.tagId]))) {
			return { status: 'not_found' };
		}
		const records: StoredCommand[] = [];
		for (const requested of task.commands) {
			const current = await this.readCommand(tx, userId, requested.id);
			if (!current) {
				return { status: 'not_found' };
			}
			if (current.version !== requested.expectedVersion) {
				return { status: 'version_conflict' };
			}
			if (!current.tagIds.includes(task.tagId)) {
				if (current.version >= Number.MAX_SAFE_INTEGER) {
					return { status: 'limit_exceeded' };
				}
				authorization.admitCount('associations', current.tagIds.length);
			}
			records.push(current);
		}
		let count = 0;
		for (const current of records) {
			if (current.tagIds.includes(task.tagId)) {
				continue;
			}
			await tx.run('INSERT INTO preferences_command_associations(user_id,command_id,tag_id) VALUES(?,?,?)', [
				userId,
				current.id,
				task.tagId,
			]);
			await tx.run('UPDATE preferences_commands SET version=version+1,updated_at=? WHERE user_id=? AND id=?', [
				at,
				userId,
				current.id,
			]);
			count++;
		}
		return { status: 'assigned', count };
	}
}

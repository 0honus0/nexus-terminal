import type { SqlExecutor, SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { TagStorage, TagRecord, TagMutation } from '../../storage/tag-storage.js';

function decode(row: Record<string, unknown>): TagRecord {
	if (typeof row.name !== 'string') {
		throw new Error('Corrupt tag name');
	}
	for (const key of ['id', 'version', 'created_at', 'updated_at']) {
		if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key])) {
			throw new Error('Corrupt tag integer');
		}
	}
	return {
		id: row.id as number,
		name: row.name,
		version: row.version as number,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
	};
}

async function get(tx: SqlExecutor, id: number) {
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM tags WHERE id=?', [id]);
	return row ? decode(row) : null;
}

export class SqliteTagStorage implements TagStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list() {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT id,name,version,created_at,updated_at FROM tags ORDER BY id')).map(decode),
		);
	}

	get(id: number) {
		return this.db.transaction((tx) => get(tx, id));
	}

	create(name: string) {
		return this.db.transaction(async (tx) => {
			const now = Date.now(),
				result = await tx.run('INSERT INTO tags(name,created_at,updated_at) VALUES(?,?,?)', [name, now, now]);
			return (await get(tx, result.lastId))!;
		});
	}

	rename(id: number, version: number, name: string): Promise<TagMutation> {
		return this.db.transaction(async (tx) => {
			const before = await get(tx, id);
			if (!before) {
				return { status: 'not_found' };
			}
			if (before.version !== version) {
				return { status: 'version_conflict' };
			}
			await tx.run('UPDATE tags SET name=?,version=version+1,updated_at=? WHERE id=? AND version=?', [
				name,
				Date.now(),
				id,
				version,
			]);
			return { status: 'updated', value: (await get(tx, id))! };
		});
	}

	delete(id: number) {
		return this.db.transaction(async (tx) => {
			if (await tx.one('SELECT 1 AS used FROM connection_tags WHERE tag_id=? LIMIT 1', [id])) {
				throw new Error('Tag is in use');
			}
			return (await tx.run('DELETE FROM tags WHERE id=?', [id])).changes > 0;
		});
	}
}

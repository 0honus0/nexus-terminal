import { TargetFailure } from '../../../target-failure.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { TagStorage, TagRecord, TagMutation } from '../../storage/tag-storage.js';

function decodeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new Error('Corrupt tag integer');
	}
	return value;
}

function decode(row: Record<string, unknown>): TagRecord {
	if (typeof row.name !== 'string') {
		throw new Error('Corrupt tag name');
	}

	return {
		id: decodeInteger(row.id),
		name: row.name,
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at),
		updatedAt: decodeInteger(row.updated_at),
	};
}

async function readTagRecord(tx: SqlExecutor, id: number): Promise<TagRecord | null> {
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM tags WHERE id=?', [id]);
	return row ? decode(row) : null;
}

async function readRequiredTagRecord(tx: SqlExecutor, id: number): Promise<TagRecord> {
	const record = await readTagRecord(tx, id);
	if (record === null) {
		throw new Error('tag missing after write');
	}
	return record;
}

export class SqliteTagStorage implements TagStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(): Promise<TagRecord[]> {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT id,name,version,created_at,updated_at FROM tags ORDER BY id')).map(decode),
		);
	}

	get(id: number): Promise<TagRecord | null> {
		return this.db.transaction((tx) => readTagRecord(tx, id));
	}

	create(name: string): Promise<TagRecord> {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			const result = await tx.run('INSERT INTO tags(name,created_at,updated_at) VALUES(?,?,?)', [name, now, now]);
			return await readRequiredTagRecord(tx, result.lastId);
		});
	}

	rename(id: number, version: number, name: string): Promise<TagMutation> {
		return this.db.transaction(async (tx) => {
			const before = await readTagRecord(tx, id);
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
			return { status: 'updated', value: await readRequiredTagRecord(tx, id) };
		});
	}

	delete(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (await tx.one('SELECT 1 AS used FROM connection_tags WHERE tag_id=? LIMIT 1', [id])) {
				throw new TargetFailure('reference_in_use');
			}
			return (await tx.run('DELETE FROM tags WHERE id=?', [id])).changes > 0;
		});
	}
}

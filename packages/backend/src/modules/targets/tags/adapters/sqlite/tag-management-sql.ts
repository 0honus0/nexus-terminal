import type {
	ConnectionTagTransactionStorage,
	ConnectionTagWrite,
	ValidateConnectionTagCount,
} from '../../../connections/storage/connection-tag-storage.js';
import { TARGET_TAG_NAME_MAX_BYTES } from '@nexus-terminal/shared/targets/tags/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { TagStorage, TagRecord, TagMutation } from '../../storage/tag-storage.js';

function decodeInteger(value: unknown, min = 1): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt tag integer');
	}
	return value;
}

export function readTagRow(row: Record<string, unknown>): TagRecord {
	if (
		typeof row.name !== 'string' ||
		!row.name.trim() ||
		Buffer.byteLength(row.name, 'utf8') > TARGET_TAG_NAME_MAX_BYTES ||
		Buffer.from(row.name, 'utf8').toString('utf8') !== row.name
	) {
		throw new Error('Corrupt tag name');
	}

	return {
		id: decodeInteger(row.id),
		name: row.name,
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at, 0),
		updatedAt: decodeInteger(row.updated_at, 0),
	};
}

async function readTagRecord(tx: SqlExecutor, id: number): Promise<TagRecord | null> {
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM tags WHERE id=?', [id]);
	return row ? readTagRow(row) : null;
}

async function readRequiredTagRecord(tx: SqlExecutor, id: number): Promise<TagRecord> {
	const record = await readTagRecord(tx, id);
	if (record === null) {
		throw new Error('tag missing after write');
	}
	return record;
}

export class SqliteTagStorage implements TagStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly connections: ConnectionTagTransactionStorage,
	) {}

	list(): Promise<TagRecord[]> {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT id,name,version,created_at,updated_at FROM tags ORDER BY id')).map(readTagRow),
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

	setConnections(command: ConnectionTagWrite, validateCount: ValidateConnectionTagCount): Promise<boolean> {
		return this.assignConnections(command, true, validateCount);
	}

	addConnections(command: ConnectionTagWrite, validateCount: ValidateConnectionTagCount): Promise<boolean> {
		return this.assignConnections(command, false, validateCount);
	}

	private assignConnections(
		command: ConnectionTagWrite,
		replace: boolean,
		validateCount: ValidateConnectionTagCount,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await readTagRecord(tx, command.tagId))) {
				return false;
			}
			await this.connections.assign(tx, command, replace, validateCount);
			return true;
		});
	}

	delete(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await readTagRecord(tx, id))) {
				return false;
			}
			await this.connections.detach(tx, id);
			return (await tx.run('DELETE FROM tags WHERE id=?', [id])).changes > 0;
		});
	}
}

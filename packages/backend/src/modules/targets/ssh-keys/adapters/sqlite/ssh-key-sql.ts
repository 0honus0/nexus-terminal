import { TargetReferenceInUse } from '../../../storage/target-storage-refusal.js';
import { TARGET_SSH_KEY_NAME_MAX_BYTES } from '@nexus-terminal/shared/targets/ssh-keys/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	SshKeyStorage,
	SshKeySummary,
	SshKeyWrite,
	SshKeyPatch,
	SshKeyMutation,
} from '../../storage/ssh-key-storage.js';

function decodeInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt SSH key integer');
	}
	return value;
}

export function readSshKeyRow(row: Record<string, unknown>): SshKeySummary {
	if (
		typeof row.name !== 'string' ||
		!row.name.trim() ||
		Buffer.byteLength(row.name, 'utf8') > TARGET_SSH_KEY_NAME_MAX_BYTES ||
		Buffer.from(row.name, 'utf8').toString('utf8') !== row.name
	) {
		throw new Error('Corrupt SSH key name');
	}

	return {
		id: decodeInteger(row.id),
		name: row.name,
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at, 0),
		updatedAt: decodeInteger(row.updated_at, 0),
	};
}

async function readSshKeySummary(tx: SqlExecutor, id: number): Promise<SshKeySummary | null> {
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM ssh_keys WHERE id=?', [id]);
	return row ? readSshKeyRow(row) : null;
}

async function readRequiredSshKeySummary(tx: SqlExecutor, id: number): Promise<SshKeySummary> {
	const record = await readSshKeySummary(tx, id);
	if (record === null) {
		throw new Error('SSH key missing after write');
	}
	return record;
}

/** Import joins the same key owner to its surrounding transaction. */
export async function insertSshKeyInTransaction(tx: SqlExecutor, data: SshKeyWrite): Promise<number> {
	const now = Date.now();
	const result = await tx.run(
		'INSERT INTO ssh_keys(name,encrypted_private_key,encrypted_passphrase,created_at,updated_at) VALUES(?,?,?,?,?)',
		[data.name, data.encryptedPrivateKey, data.encryptedPassphrase, now, now],
	);
	return result.lastId;
}

export class SqliteSshKeyStorage implements SshKeyStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(): Promise<SshKeySummary[]> {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT id,name,version,created_at,updated_at FROM ssh_keys ORDER BY id')).map(readSshKeyRow),
		);
	}

	get(id: number): Promise<SshKeySummary | null> {
		return this.db.transaction((tx) => readSshKeySummary(tx, id));
	}

	create(data: SshKeyWrite): Promise<SshKeySummary> {
		return this.db.transaction(async (tx) => {
			return readRequiredSshKeySummary(tx, await insertSshKeyInTransaction(tx, data));
		});
	}

	update(id: number, version: number, patch: SshKeyPatch): Promise<SshKeyMutation> {
		return this.db.transaction(async (tx) => {
			const existing = await readSshKeySummary(tx, id);
			if (!existing) {
				return { status: 'not_found' };
			}
			if (existing.version !== version) {
				return { status: 'version_conflict' };
			}
			const allowed = [
				['name', 'name'],
				['encryptedPrivateKey', 'encrypted_private_key'],
				['encryptedPassphrase', 'encrypted_passphrase'],
			] as const;
			const columns: string[] = [];
			const parameters: (string | null)[] = [];
			for (const [key, column] of allowed) {
				const value = patch[key];
				if (value !== undefined) {
					columns.push(column + '=?');
					parameters.push(value);
				}
			}
			await tx.run(
				'UPDATE ssh_keys SET ' +
					[...columns, 'version=version+1', 'updated_at=?'].join(',') +
					' WHERE id=? AND version=?',
				[...parameters, Date.now(), id, version],
			);
			return { status: 'updated', value: await readRequiredSshKeySummary(tx, id) };
		});
	}

	delete(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (await tx.one('SELECT 1 FROM connection_credentials WHERE ssh_key_id=? LIMIT 1', [id])) {
				throw new TargetReferenceInUse();
			}
			return (await tx.run('DELETE FROM ssh_keys WHERE id=?', [id])).changes > 0;
		});
	}
}

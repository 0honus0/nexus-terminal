import type { SqlExecutor, SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	SshKeyStorage,
	SshKeySummary,
	SshKeyWrite,
	SshKeyPatch,
	SshKeyMutation,
} from '../../storage/ssh-key-storage.js';

function decode(row: Record<string, unknown>): SshKeySummary {
	if (typeof row.name !== 'string') {
		throw new Error('Corrupt SSH key name');
	}
	for (const k of ['id', 'version', 'created_at', 'updated_at']) {
		if (typeof row[k] !== 'number' || !Number.isSafeInteger(row[k])) {
			throw new Error('Corrupt SSH key integer');
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

async function get(tx: SqlExecutor, id: number): Promise<SshKeySummary | null> {
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM ssh_keys WHERE id=?', [id]);
	return row ? decode(row) : null;
}

export class SqliteSshKeyStorage implements SshKeyStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list() {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT id,name,version,created_at,updated_at FROM ssh_keys ORDER BY id')).map(decode),
		);
	}

	get(id: number) {
		return this.db.transaction((tx) => get(tx, id));
	}

	create(data: SshKeyWrite) {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			const result = await tx.run(
				'INSERT INTO ssh_keys(name,encrypted_private_key,encrypted_passphrase,created_at,updated_at) VALUES(?,?,?,?,?)',
				[data.name, data.encryptedPrivateKey, data.encryptedPassphrase, now, now],
			);
			return (await get(tx, result.lastId))!;
		});
	}

	update(id: number, version: number, patch: SshKeyPatch): Promise<SshKeyMutation> {
		return this.db.transaction(async (tx) => {
			const existing = await get(tx, id);
			if (!existing) {
				return { status: 'not_found' };
			}
			if (existing.version !== version) {
				return { status: 'version_conflict' };
			}
			const allowed = {
				name: 'name',
				encryptedPrivateKey: 'encrypted_private_key',
				encryptedPassphrase: 'encrypted_passphrase',
			} as const;
			const cols: string[] = [],
				params: (string | null)[] = [];
			for (const k of Object.keys(allowed) as (keyof typeof allowed)[]) {
				if (patch[k] !== undefined) {
					cols.push(allowed[k] + '=?');
					params.push(patch[k] as string | null);
				}
			}
			await tx.run(
				'UPDATE ssh_keys SET ' +
					[...cols, 'version=version+1', 'updated_at=?'].join(',') +
					' WHERE id=? AND version=?',
				[...params, Date.now(), id, version],
			);
			return { status: 'updated', value: (await get(tx, id))! };
		});
	}

	delete(id: number) {
		return this.db.transaction(async (tx) => (await tx.run('DELETE FROM ssh_keys WHERE id=?', [id])).changes > 0);
	}
}

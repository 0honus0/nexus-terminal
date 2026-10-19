import { ConnectionCredentialStorageRefusal } from '../../storage/connection-credential-storage.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ConnectionCredentialStorage,
	ConnectionCredentialWrite,
	CredentialMutation,
	CredentialWriteValidator,
	StoredConnectionCredential,
	StoredCredentialSnapshot,
} from '../../storage/connection-credential-storage.js';

/** Used by runtime resolution and full snapshot validation. */
export function readConnectionCredentialRow(row: Record<string, unknown>): StoredConnectionCredential {
	if (
		typeof row.connection_id !== 'number' ||
		!Number.isSafeInteger(row.connection_id) ||
		row.connection_id < 1 ||
		typeof row.updated_at !== 'number' ||
		!Number.isSafeInteger(row.updated_at) ||
		row.updated_at < 0
	) {
		throw new Error('Corrupt connection credential identity');
	}
	if (
		row.auth_method === 'password' &&
		typeof row.encrypted_password === 'string' &&
		row.encrypted_password.length > 0 &&
		row.ssh_key_id === null
	) {
		return {
			connectionId: row.connection_id,
			updatedAt: row.updated_at,
			kind: 'password',
			encryptedPassword: row.encrypted_password,
		};
	}
	if (
		row.auth_method === 'ssh_key' &&
		row.encrypted_password === null &&
		typeof row.ssh_key_id === 'number' &&
		Number.isSafeInteger(row.ssh_key_id) &&
		row.ssh_key_id > 0
	) {
		return {
			connectionId: row.connection_id,
			updatedAt: row.updated_at,
			kind: 'ssh_key',
			sshKeyId: row.ssh_key_id,
		};
	}
	throw new Error('Corrupt connection credential representation');
}

/** Writes only credentials; the caller owns connection creation/version in this transaction. */
export async function writeCredentialInTransaction(
	tx: SqlExecutor,
	id: number,
	value: ConnectionCredentialWrite,
	timestamp: number,
): Promise<void> {
	if (value.kind === 'ssh_key' && !(await tx.one('SELECT id FROM ssh_keys WHERE id=?', [value.sshKeyId]))) {
		throw new ConnectionCredentialStorageRefusal('missing_key');
	}
	await tx.run(
		'INSERT INTO connection_credentials(connection_id,auth_method,encrypted_password,ssh_key_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET auth_method=excluded.auth_method,encrypted_password=excluded.encrypted_password,ssh_key_id=excluded.ssh_key_id,updated_at=excluded.updated_at',
		[
			id,
			value.kind,
			value.kind === 'password' ? value.encryptedPassword : null,
			value.kind === 'ssh_key' ? value.sshKeyId : null,
			timestamp,
		],
	);
}

export class SqliteConnectionCredentialStorage implements ConnectionCredentialStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly validateWrite: CredentialWriteValidator,
	) {}

	async get(id: number): Promise<StoredCredentialSnapshot | null> {
		const row = await this.db.one(
			'SELECT c.id,c.version,k.connection_id,k.auth_method,k.encrypted_password,k.ssh_key_id,k.updated_at FROM connections c LEFT JOIN connection_credentials k ON k.connection_id=c.id WHERE c.id=?',
			[id],
		);
		if (!row) {
			return null;
		}
		if (
			typeof row.id !== 'number' ||
			!Number.isSafeInteger(row.id) ||
			row.id < 1 ||
			typeof row.version !== 'number' ||
			!Number.isSafeInteger(row.version) ||
			row.version < 1
		) {
			throw new Error('Corrupt credential snapshot identity');
		}
		let credential: StoredCredentialSnapshot['credential'] = { kind: 'none' };
		if (row.connection_id !== null) {
			const stored = readConnectionCredentialRow(row);
			credential =
				stored.kind === 'password' ? { kind: 'password' } : { kind: 'ssh_key', sshKeyId: stored.sshKeyId };
		}
		return { connectionId: row.id, version: row.version, credential };
	}

	set(id: number, version: number, value: ConnectionCredentialWrite): Promise<CredentialMutation> {
		return this.commit(id, version, value);
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		return this.commit(id, version, null);
	}

	private commit(id: number, version: number, value: ConnectionCredentialWrite | null): Promise<CredentialMutation> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one('SELECT version,type FROM connections WHERE id=?', [id]);
			if (!row) {
				return { status: 'not_found' };
			}
			if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
				throw new Error('Corrupt credential connection version');
			}
			if (row.version !== version) {
				return { status: 'version_conflict' };
			}
			if (version === Number.MAX_SAFE_INTEGER) {
				throw new Error('Connection version exhausted');
			}
			if (row.type !== 'SSH' && row.type !== 'RDP' && row.type !== 'VNC') {
				throw new Error('Corrupt credential connection type');
			}
			this.validateWrite(row.type, value?.kind ?? null);
			if (value === null) {
				await tx.run('DELETE FROM connection_credentials WHERE connection_id=?', [id]);
			} else {
				await writeCredentialInTransaction(tx, id, value, Date.now());
			}
			await tx.run('UPDATE connections SET version=version+1,updated_at=? WHERE id=? AND version=?', [
				Date.now(),
				id,
				version,
			]);
			return { status: 'updated' };
		});
	}
}

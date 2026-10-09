import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ConnectionCredentialStorage,
	SshCredentialWrite,
	CredentialMutation,
} from '../../storage/connection-credential-storage.js';
export class SqliteConnectionCredentialStorage implements ConnectionCredentialStorage {
	constructor(private readonly db: SqliteRuntime) {}

	set(id: number, version: number, value: SshCredentialWrite): Promise<CredentialMutation> {
		return this.commit(id, version, value);
	}

	clear(id: number, version: number): Promise<CredentialMutation> {
		return this.commit(id, version, null);
	}

	private commit(id: number, version: number, value: SshCredentialWrite | null): Promise<CredentialMutation> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one('SELECT version,type FROM connections WHERE id=?', [id]);
			if (!row) {
				return { status: 'not_found' };
			}
			if (row.version !== version) {
				return { status: 'version_conflict' };
			}
			if (row.type !== 'SSH') {
				throw new Error('Credentials require an SSH connection');
			}
			if (
				value?.kind === 'ssh_key' &&
				!(await tx.one('SELECT 1 AS present FROM ssh_keys WHERE id=?', [value.sshKeyId]))
			) {
				throw new Error('SSH key not found');
			}
			if (value === null) {
				await tx.run('DELETE FROM connection_credentials WHERE connection_id=?', [id]);
			} else {
				await tx.run(
					'INSERT INTO connection_credentials(connection_id,auth_method,encrypted_password,ssh_key_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET auth_method=excluded.auth_method,encrypted_password=excluded.encrypted_password,ssh_key_id=excluded.ssh_key_id,updated_at=excluded.updated_at',
					[
						id,
						value.kind,
						value.kind === 'password' ? value.encryptedPassword : null,
						value.kind === 'ssh_key' ? value.sshKeyId : null,
						Date.now(),
					],
				);
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

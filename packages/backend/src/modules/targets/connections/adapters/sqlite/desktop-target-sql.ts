import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { DesktopTargetStorage, StoredDesktopTarget } from '../../storage/desktop-target-storage.js';
import { readConnectionCredentialRow } from './connection-credential-sql.js';
import { readConnectionMetadataRow } from './connection-sql.js';

/** Desktop configuration and password ciphertext are read atomically. */
export class SqliteDesktopTargetAdapter implements DesktopTargetStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(id: number): Promise<StoredDesktopTarget | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT c.*,
				        k.connection_id AS credential_connection_id,k.updated_at AS credential_updated_at,
				        k.auth_method,k.encrypted_password,k.ssh_key_id
				   FROM connections c
				   LEFT JOIN connection_credentials k ON k.connection_id=c.id
				  WHERE c.id=?`,
				[id],
			);
			if (!row) {
				return null;
			}
			const metadata = readConnectionMetadataRow(row);
			const credential =
				row.credential_connection_id === null
					? null
					: readConnectionCredentialRow({
							connection_id: row.credential_connection_id,
							updated_at: row.credential_updated_at,
							auth_method: row.auth_method,
							encrypted_password: row.encrypted_password,
							ssh_key_id: row.ssh_key_id,
						});
			return {
				id: metadata.id,
				version: metadata.version,
				type: metadata.type,
				host: metadata.host,
				port: metadata.port,
				username: metadata.username,
				route: metadata.route,
				rdpRemoteApp: metadata.rdpRemoteApp,
				rdpRemoteAppDirectory: metadata.rdpRemoteAppDirectory,
				rdpRemoteAppArguments: metadata.rdpRemoteAppArguments,
				encryptedPassword: credential?.kind === 'password' ? credential.encryptedPassword : null,
			};
		});
	}

	markAttempt(id: number, version: number, timestamp: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const result = await tx.run(
				"UPDATE connections SET last_connected_at=? WHERE id=? AND version=? AND type IN ('RDP','VNC')",
				[timestamp, id, version],
			);
			return result.changes === 1;
		});
	}
}

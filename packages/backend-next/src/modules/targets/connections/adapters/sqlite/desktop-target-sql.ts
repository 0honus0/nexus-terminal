import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { DesktopTargetStorage, StoredDesktopTarget } from '../../storage/desktop-target-storage.js';

function positiveInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error('Invalid desktop target integer');
	}
	return value;
}

/** Desktop configuration and password ciphertext are read atomically. */
export class SqliteDesktopTargetAdapter implements DesktopTargetStorage {
	constructor(private readonly db: SqliteRuntime) {}

	get(id: number): Promise<StoredDesktopTarget | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT c.id,c.version,c.type,c.host,c.port,c.username,c.route,
				        c.rdp_remote_app,c.rdp_remote_app_directory,c.rdp_remote_app_arguments,
				        k.auth_method,k.encrypted_password
				   FROM connections c
				   LEFT JOIN connection_credentials k ON k.connection_id=c.id
				  WHERE c.id=?`,
				[id],
			);
			if (!row) {
				return null;
			}
			if (row.type !== 'SSH' && row.type !== 'RDP' && row.type !== 'VNC') {
				throw new Error('Invalid stored connection type');
			}
			const targetId = positiveInteger(row.id);
			const version = positiveInteger(row.version);
			const port = positiveInteger(row.port);
			if (
				port > 65535 ||
				typeof row.host !== 'string' ||
				typeof row.username !== 'string' ||
				(row.route !== 'direct' && row.route !== 'proxy' && row.route !== 'jump') ||
				!(row.rdp_remote_app === null || typeof row.rdp_remote_app === 'string') ||
				!(row.rdp_remote_app_directory === null || typeof row.rdp_remote_app_directory === 'string') ||
				!(row.rdp_remote_app_arguments === null || typeof row.rdp_remote_app_arguments === 'string') ||
				!(row.encrypted_password === null || typeof row.encrypted_password === 'string')
			) {
				// Corrupt storage is distinct from missing or wrong-type targets.
				throw new Error('Invalid desktop target configuration');
			}
			return {
				id: targetId,
				version,
				type: row.type,
				host: row.host,
				port,
				username: row.username,
				route: row.route,
				rdpRemoteApp: row.rdp_remote_app,
				rdpRemoteAppDirectory: row.rdp_remote_app_directory,
				rdpRemoteAppArguments: row.rdp_remote_app_arguments,
				encryptedPassword: row.auth_method === 'password' ? row.encrypted_password : null,
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

import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import type { SecretBox } from '../../../../../platform/security/secret-box.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import { readConnection } from '../../../connections/adapters/sqlite/connection-sql.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { readSshGraph } from '../../../connections/adapters/sqlite/ssh-graph-sql.js';
import type { ConnectionSnapshotValidator, StoredConnection } from '../../../connections/storage/connection-storage.js';
import { readProxyRow, readProxyCredentialRow } from '../../../proxies/adapters/sqlite/proxy-management-sql.js';
import { readTagRow } from '../../../tags/adapters/sqlite/tag-management-sql.js';
import { readSshKeyRow } from '../../../ssh-keys/adapters/sqlite/ssh-key-sql.js';
import { readHostKeyRow } from '../../../host-keys/adapters/sqlite/host-key-sql.js';
import { readConnectionCredentialRow } from '../../../connections/adapters/sqlite/connection-credential-sql.js';
import type { CredentialWriteValidator } from '../../../connections/storage/connection-credential-storage.js';
import { TARGET_CONNECTION_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import { TARGET_PROXY_PASSWORD_MAX_BYTES } from '@nexus-terminal/shared/targets/proxies/values';
import {
	TARGET_SSH_PRIVATE_KEY_MAX_BYTES,
	TARGET_SSH_PASSPHRASE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/ssh-keys/values';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';

const secretBudgets = new Map([
	['connection:password', TARGET_CONNECTION_PASSWORD_MAX_BYTES],
	['proxy:password', TARGET_PROXY_PASSWORD_MAX_BYTES],
	['ssh-key:private', TARGET_SSH_PRIVATE_KEY_MAX_BYTES],
	['ssh-key:passphrase', TARGET_SSH_PASSPHRASE_MAX_BYTES],
]);

/** Budgets apply to portable plaintext, before re-encryption expands its representation. */
function hasValidPortableSecretSizes(row: SqlRow, columns: ReadonlyMap<string, string>): boolean {
	for (const [column, scope] of columns) {
		const maxBytes = secretBudgets.get(scope);
		if (maxBytes === undefined) {
			throw new SnapshotFailure('invalid_registration');
		}
		const value = row[column];
		if (value !== null && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes)) {
			return false;
		}
	}
	return true;
}

function secretColumns(table: string): ReadonlyMap<string, string> {
	if (table === 'ssh_keys') {
		return new Map([
			['encrypted_private_key', 'ssh-key:private'],
			['encrypted_passphrase', 'ssh-key:passphrase'],
		]);
	}
	if (table === 'connection_credentials') {
		return new Map([['encrypted_password', 'connection:password']]);
	}
	if (table === 'proxy_credentials') {
		return new Map([['encrypted_password', 'proxy:password']]);
	}
	return new Map();
}

/** Fixed current table/column coverage owned by targets; no runtime schema discovery. */
export function registerTargetsSnapshot(
	secrets: SecretBox | null,
	validateSnapshot: ConnectionSnapshotValidator,
	validateCredential: CredentialWriteValidator,
): SnapshotRegistration {
	const tables: SnapshotTable[] = [
		{
			name: 'connection_credentials',
			columns: ['connection_id', 'auth_method', 'encrypted_password', 'ssh_key_id', 'updated_at'],
		},
		{
			name: 'connections',
			columns: [
				'id',
				'name',
				'type',
				'host',
				'port',
				'username',
				'route',
				'proxy_id',
				'notes',
				'rdp_remote_app',
				'rdp_remote_app_directory',
				'rdp_remote_app_arguments',
				'version',
				'created_at',
				'updated_at',
				'last_connected_at',
			],
		},
		{ name: 'connection_tags', columns: ['connection_id', 'tag_id'] },
		{ name: 'connection_jumps', columns: ['connection_id', 'position', 'jump_connection_id'] },
		{ name: 'target_host_keys', columns: ['host', 'port', 'fingerprint', 'confirmed_at'] },
		{
			name: 'proxies',
			columns: ['id', 'name', 'type', 'host', 'port', 'username', 'version', 'created_at', 'updated_at'],
		},
		{ name: 'proxy_credentials', columns: ['proxy_id', 'encrypted_password', 'updated_at'] },
		{
			name: 'ssh_keys',
			columns: [
				'id',
				'name',
				'encrypted_private_key',
				'encrypted_passphrase',
				'version',
				'created_at',
				'updated_at',
			],
		},
		{ name: 'tags', columns: ['id', 'name', 'version', 'created_at', 'updated_at'] },
	];
	return {
		tables,

		validate(rows) {
			for (const row of rows.get('connection_credentials') ?? []) {
				readConnectionCredentialRow(row);
			}
			for (const row of rows.get('proxies') ?? []) {
				readProxyRow(row);
			}
			for (const row of rows.get('proxy_credentials') ?? []) {
				readProxyCredentialRow(row);
			}
			for (const row of rows.get('tags') ?? []) {
				readTagRow(row);
			}
			for (const row of rows.get('ssh_keys') ?? []) {
				readSshKeyRow(row);
			}
			for (const row of rows.get('target_host_keys') ?? []) {
				readHostKeyRow(row);
			}
		},

		async validateStorage(reader, rows, signal) {
			const graph = await readSshGraph(reader);
			const connections: StoredConnection[] = [];
			for (const row of rows.get('connections') ?? []) {
				signal.throwIfAborted();
				if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1) {
					throw new SnapshotFailure('unavailable');
				}
				const connection = await readConnection(reader, row.id);
				if (!connection) {
					throw new SnapshotFailure('unavailable');
				}
				connections.push(connection);
			}
			validateSnapshot(connections, graph);
			const byId = new Map(connections.map((connection) => [connection.id, connection]));
			for (const row of rows.get('connection_credentials') ?? []) {
				signal.throwIfAborted();
				const credential = readConnectionCredentialRow(row);
				const connection = byId.get(credential.connectionId);
				if (!connection) {
					throw new SnapshotFailure('unavailable');
				}
				validateCredential(connection.type, credential.kind);
			}
		},

		transfer(table, row) {
			const columns = secretColumns(table.name);
			const portable = transferSnapshotRow(row, table.columns, columns, secrets);
			if (!hasValidPortableSecretSizes(portable, columns)) {
				throw new SnapshotFailure('unavailable');
			}
			return portable;
		},

		restore(table, row) {
			const columns = secretColumns(table.name);
			if (!hasValidPortableSecretSizes(row, columns)) {
				throw new SnapshotFailure('invalid_archive');
			}
			return restoreSnapshotRow(row, table.columns, columns, secrets);
		},

		files() {
			return [];
		},
	};
}

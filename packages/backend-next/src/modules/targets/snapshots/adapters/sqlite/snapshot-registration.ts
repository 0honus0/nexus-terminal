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
import { readProxyRow } from '../../../proxies/adapters/sqlite/proxy-management-sql.js';
import { readTagRow } from '../../../tags/adapters/sqlite/tag-management-sql.js';
import { readSshKeyRow } from '../../../ssh-keys/adapters/sqlite/ssh-key-sql.js';
import { readHostKeyRow } from '../../../host-keys/adapters/sqlite/host-key-sql.js';

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
			for (const row of rows.get('proxies') ?? []) {
				readProxyRow(row);
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
		},

		transfer(table, row) {
			return transferSnapshotRow(row, table.columns, secretColumns(table.name), secrets);
		},

		restore(table, row) {
			return restoreSnapshotRow(row, table.columns, secretColumns(table.name), secrets);
		},

		files() {
			return [];
		},
	};
}

import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readAgentPluginConnector } from '@nexus-terminal/shared/agent/plugins/connection';
import { PluginConnectionRefusal } from '../../storage/plugin-connection-storage.js';
import type {
	PluginConnectionStorage,
	StoredPluginConnection,
	StoredPluginConnector,
} from '../../storage/plugin-connection-storage.js';

export function readStoredPluginConnector(json: unknown): StoredPluginConnector {
	if (typeof json !== 'string') {
		throw new Error('Invalid plugin connection');
	}
	const input: unknown = JSON.parse(json);
	const value = readAgentPluginConnector(input);
	return value.kind === 'none'
		? { kind: 'none' }
		: value.kind === 'http'
			? {
					kind: value.kind,
					endpoint: value.endpoint,
					privateAuthorities: value.privateAuthorities.map((item) => item),
				}
			: {
					kind: value.kind,
					connectionId: value.connectionId,
					argv: value.argv.map((item) => item),
					cwd: value.cwd,
				};
}

async function read(tx: SqlReader, userId: number, appId: string, instanceId: string): Promise<StoredPluginConnection> {
	if (
		!(await tx.one('SELECT id FROM agent_plugin_instances WHERE id=? AND user_id=? AND app_id=?', [
			instanceId,
			userId,
			appId,
		]))
	) {
		throw new PluginConnectionRefusal('not_found');
	}
	const row = await tx.one('SELECT * FROM agent_plugin_connections WHERE instance_id=? AND user_id=? AND app_id=?', [
		instanceId,
		userId,
		appId,
	]);
	if (!row) {
		return { instanceId, revision: 0, connector: { kind: 'none' }, encryptedCredential: null };
	}
	if (
		typeof row.revision !== 'number' ||
		!Number.isSafeInteger(row.revision) ||
		row.revision < 1 ||
		(row.encrypted_credential !== null && typeof row.encrypted_credential !== 'string')
	) {
		throw new Error('Invalid plugin connection row');
	}
	return {
		instanceId,
		revision: row.revision,
		connector: readStoredPluginConnector(row.connector_json),
		encryptedCredential: row.encrypted_credential,
	};
}

export class SqlitePluginConnectionStorage implements PluginConnectionStorage {
	private identityReader: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installIdentityReader(reader: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.identityReader) {
			throw new Error('Plugin connection identity reader already installed');
		}
		this.identityReader = reader;
	}

	private async manual(tx: SqlExecutor, userId: number, digest: string): Promise<void> {
		if (!this.identityReader || (await this.identityReader(tx, digest)) !== userId) {
			throw new PluginConnectionRefusal('unauthenticated');
		}
	}

	read(userId: number, appId: string, instanceId: string, digest: string | null): Promise<StoredPluginConnection> {
		return this.db.transaction(async (tx) => {
			if (digest !== null) {
				await this.manual(tx, userId, digest);
			}
			return read(tx, userId, appId, instanceId);
		});
	}

	write(
		userId: number,
		appId: string,
		instanceId: string,
		digest: string,
		expectedRevision: number,
		connector: StoredPluginConnector,
		credential: { action: 'keep' } | { action: 'replace'; encrypted: string | null },
	): Promise<StoredPluginConnection> {
		return this.db.transaction(async (tx) => {
			await this.manual(tx, userId, digest);
			const original = await read(tx, userId, appId, instanceId);
			if (original.revision !== expectedRevision || original.revision >= Number.MAX_SAFE_INTEGER) {
				throw new PluginConnectionRefusal('version_conflict');
			}
			const instance = await tx.one(
				`SELECT logical.id FROM agent_plugin_instances logical
			 JOIN agent_plugin_packages p ON p.user_id=logical.user_id AND p.package_id=logical.package_id AND p.status='installed'
			 JOIN agent_plugin_publishers publisher ON publisher.user_id=p.user_id AND publisher.key_id=p.publisher_key_id AND publisher.revoked_at IS NULL
			 WHERE logical.id=? AND logical.user_id=? AND logical.app_id=?`,
				[instanceId, userId, appId],
			);
			if (!instance) {
				throw new PluginConnectionRefusal('forbidden');
			}
			const fenced = await tx.run(
				`UPDATE agent_plugin_instances SET configuration_revision=configuration_revision+1,
			 updated_at=? WHERE id=? AND user_id=? AND app_id=? AND configuration_revision<?`,
				[Date.now(), instanceId, userId, appId, Number.MAX_SAFE_INTEGER],
			);
			if (fenced.changes !== 1) {
				throw new PluginConnectionRefusal('version_conflict');
			}
			const encrypted = credential.action === 'keep' ? original.encryptedCredential : credential.encrypted;
			if (connector.kind !== 'http' && encrypted !== null) {
				throw new PluginConnectionRefusal('forbidden');
			}
			await tx.run(
				`INSERT INTO agent_plugin_connections(instance_id,user_id,app_id,revision,connector_json,encrypted_credential,updated_at)
			 VALUES(?,?,?,?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET revision=excluded.revision,connector_json=excluded.connector_json,
			 encrypted_credential=excluded.encrypted_credential,updated_at=excluded.updated_at`,
				[instanceId, userId, appId, original.revision + 1, JSON.stringify(connector), encrypted, Date.now()],
			);
			return read(tx, userId, appId, instanceId);
		});
	}
}

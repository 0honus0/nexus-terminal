import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';
import type { ConnectionImportCommitPort } from '../../../modules/connections/connection-import.port';
import type { CreateConnectionInput } from '../../../modules/connections/connection.types';
import type { ProxyInput } from '../../../modules/proxies/proxy.types';
import { ConnectionService } from '../../../modules/connections/connection.service';
import { ConnectionCredentialService } from '../../../modules/connections/connection-credential.service';
import { ProxyService } from '../../../modules/proxies/proxy.service';
import { SshKeyService } from '../../../modules/ssh-keys/ssh-key.service';
import { AuditLogService } from '../../../modules/audit/audit.service';
import { SqliteConnectionRepository } from './sqlite-connection.repository';
import { SqliteProxyRepository } from './sqlite-proxy.repository';
import { SqliteSshKeyRepository } from './sqlite-ssh-key.repository';
import { SqliteAuditLogRepository } from './sqlite-audit-log.repository';

/** One imported record is one aggregate commit; repository transactions join this scope. */
export class SqliteConnectionImportAdapter implements ConnectionImportCommitPort {
	constructor(
		private readonly db: RelationalDatabase,
		private readonly cipher: SecretCipher,
	) {}

	async create(connection: CreateConnectionInput, proxy?: ProxyInput | null): Promise<void> {
		await this.db.transaction(async (tx) => {
			const joined: RelationalDatabase = {
				execute: (sql, parameters) => tx.execute(sql, parameters),

				queryOne: (sql, parameters) => tx.queryOne(sql, parameters),

				queryAll: (sql, parameters) => tx.queryAll(sql, parameters),

				transaction: (work) => work(joined),

				close: () => Promise.reject(new Error('Import transaction cannot close database.')),
			};
			const proxies = new ProxyService(new SqliteProxyRepository(joined), this.cipher);
			const keys = new SshKeyService(new SqliteSshKeyRepository(joined), this.cipher);
			const connections = new ConnectionService(
				new SqliteConnectionRepository(joined),
				new ConnectionCredentialService(this.cipher, keys),
				new AuditLogService(new SqliteAuditLogRepository(joined)),
			);
			let proxyId = connection.proxyId ?? null;
			if (proxy) {
				const existing = await new SqliteProxyRepository(joined).findDuplicate(
					proxy.name.trim(),
					proxy.type,
					proxy.host.trim(),
					proxy.port,
				);
				proxyId = existing?.id ?? (await proxies.create(proxy)).id;
			}
			await connections.create({ ...connection, proxyId });
		});
	}
}

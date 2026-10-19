import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ConnectionImportStorage, ImportConnectionCommand } from '../../storage/import-storage.js';
import type { ImportTransactionParticipants } from '../../storage/import-transaction.js';
import type { StoredConnection } from '../../../connections/storage/connection-storage.js';
import type { ConnectionCredentialWrite } from '../../../connections/storage/connection-credential-storage.js';

export class SqliteConnectionImportAdapter implements ConnectionImportStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly participants: ImportTransactionParticipants,
	) {}

	importOne(command: ImportConnectionCommand): Promise<StoredConnection> {
		return this.db.transaction(async (tx) => {
			const data = { ...command.connection, tagIds: [...command.connection.tagIds] };
			if (command.inlineProxy) {
				data.proxyId = await this.participants.proxies.findOrCreate(tx, command.inlineProxy);
			}
			if (command.tagNames) {
				for (const name of command.tagNames) {
					data.tagIds.push(await this.participants.tags.findOrCreate(tx, name));
				}
				data.tagIds = [...new Set(data.tagIds)];
			}
			const record = await this.participants.connections.insert(tx, data);
			const credential = command.credential;
			if (credential !== undefined) {
				const value: ConnectionCredentialWrite =
					credential.kind === 'password'
						? { kind: 'password', encryptedPassword: credential.encryptedPassword }
						: {
								kind: 'ssh_key',
								sshKeyId:
									credential.kind === 'private_key'
										? await this.participants.sshKeys.insert(tx, credential.key)
										: credential.sshKeyId,
							};
				await this.participants.credentials.write(tx, record.id, value, record.updatedAt);
			}
			return record;
		});
	}
}

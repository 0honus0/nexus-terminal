import { TargetFailure } from '../../../target-failure.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ConnectionImportStorage, ImportConnectionCommand } from '../../storage/import-storage.js';
import type { ImportTransactionParticipants } from '../../storage/import-transaction.js';
import type { StoredConnection } from '../../../connections/storage/connection-storage.js';

export class SqliteConnectionImportAdapter implements ConnectionImportStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly participants: ImportTransactionParticipants,
	) {}

	importOne(command: ImportConnectionCommand): Promise<StoredConnection> {
		return this.db.transaction(async (tx) => {
			const data = { ...command.connection, tagIds: [...command.connection.tagIds] };
			if (command.inlineProxy) {
				if (data.route !== 'proxy' || data.proxyId !== null) {
					throw new TargetFailure('invalid_input');
				}
				data.proxyId = await this.participants.proxies.findOrCreate(tx, command.inlineProxy);
			}
			if (command.tagNames) {
				for (const name of command.tagNames) {
					data.tagIds.push(await this.participants.tags.findOrCreate(tx, name));
				}
				data.tagIds = [...new Set(data.tagIds)];
			}
			return this.participants.connections.insert(tx, data);
		});
	}
}

import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ManagementStorage, ManagementAuthorization } from '../../storage/management-storage.js';

export class SqliteManagementStorage implements ManagementStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Targets identity already installed');
		}
		this.readIdentity = read;
	}

	withAuthorization(authorization: ManagementAuthorization, work: () => Promise<void>): Promise<void> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Targets identity not installed'));
		}
		return this.db.withTransactionAdmission(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
		}, work);
	}
}

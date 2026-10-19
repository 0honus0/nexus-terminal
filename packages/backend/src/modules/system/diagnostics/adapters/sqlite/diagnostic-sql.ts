import { SqliteSchemaAdapter } from '../../../../../platform/storage/sqlite/adapters/schema-sql.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { DiagnosticStorage } from '../../storage/diagnostic-storage.js';

export class SqliteDiagnosticStorage implements DiagnosticStorage {
	constructor(private readonly db: SqliteRuntime) {}

	schemaVersion(): Promise<number> {
		return this.db.transaction(async (tx) => {
			const version = await new SqliteSchemaAdapter(tx).latestVersion();
			if (version === null) {
				throw new Error('Database diagnostic unavailable');
			}
			return version;
		});
	}
}

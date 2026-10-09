import type { SqlExecutor } from '../../../platform/storage/sqlite/sqlite-runtime.js';

/** Targets owns persistent verified SSH public keys; Bootstrap only orders migrations. */
export async function initializeHostKeySchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE target_host_keys(
			host TEXT NOT NULL COLLATE NOCASE,
			port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
			fingerprint TEXT NOT NULL,
			confirmed_at INTEGER NOT NULL,
			PRIMARY KEY(host,port)
		)
	`);
}

import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeDesktopCertificates(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE remote_desktop_certificates (
		user_id INTEGER NOT NULL CHECK(user_id >= 1),
		host TEXT NOT NULL,
		port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
		fingerprint TEXT NOT NULL,
		confirmed_at INTEGER NOT NULL CHECK(confirmed_at >= 0),
		PRIMARY KEY(user_id,host,port)
	);`);
}

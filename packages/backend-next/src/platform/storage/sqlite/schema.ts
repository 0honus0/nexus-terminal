import type { SqliteRuntime } from './sqlite-runtime.js';
import type { SchemaMigration } from './schema-types.js';
import { SqliteSchemaAdapter } from './adapters/schema-sql.js';

/** Each migration's DDL and version marker commit in the same SQLite transaction. */
export async function initializeSchema(db: SqliteRuntime, migrations: readonly SchemaMigration[]): Promise<void> {
	const ordered = [...migrations].sort((a, b) => a.version - b.version);
	for (let i = 0; i < ordered.length; i++) {
		if (ordered[i].version !== i + 1 || !ordered[i].signature.trim()) {
			throw new Error('Schema migrations must be contiguous, signed and unique');
		}
	}
	const schema = new SqliteSchemaAdapter(db);
	await schema.initialize();
	const versions = await schema.versions();
	versions.forEach((row, index) => {
		if (row.version !== index + 1 || ordered[index]?.signature !== row.signature) {
			throw new Error('Incompatible or corrupt database schema version');
		}
	});
	for (const migration of ordered.slice(versions.length)) {
		await db.transaction(async (tx) => {
			const metadata = new SqliteSchemaAdapter(tx);
			if ((await metadata.latestVersion()) !== (migration.version === 1 ? null : migration.version - 1)) {
				throw new Error('Schema changed during initialization');
			}
			await migration.apply(tx);
			await metadata.record(migration.version, migration.signature, Date.now());
		});
	}
}

import type { SqlExecutor } from './sql-types.js';

export interface SchemaMigration {
	readonly version: number;
	/** Immutable marker for the exact published layout at this version. */
	readonly signature: string;
	/** Parent-table rebuilds require exclusive FK suspension outside BEGIN; never toggle in a transaction. */
	readonly rebuildsReferencedTable?: true;
	apply(tx: SqlExecutor): Promise<void>;
}

export interface SchemaVersion {
	readonly version: number;
	readonly signature: string;
}

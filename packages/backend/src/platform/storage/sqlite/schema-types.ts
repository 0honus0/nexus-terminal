import type { SqlExecutor } from './sql-types.js';

export interface SchemaMigration {
	readonly version: number;
	/** Immutable marker for the exact published layout at this version. */
	readonly signature: string;
	apply(tx: SqlExecutor): Promise<void>;
}

export interface SchemaVersion {
	readonly version: number;
	readonly signature: string;
}

import type { SqlParameter, SqlRow, SqlRunResult } from './worker-types.js';

export interface SqlReader {
	all(sql: string, params?: SqlParameter[]): Promise<SqlRow[]>;
	one(sql: string, params?: SqlParameter[]): Promise<SqlRow | null>;
}

export interface SqlExecutor extends SqlReader {
	exec(sql: string): Promise<void>;
	run(sql: string, params?: SqlParameter[]): Promise<SqlRunResult>;
}

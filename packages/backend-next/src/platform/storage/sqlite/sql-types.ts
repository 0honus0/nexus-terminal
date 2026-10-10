import type { SqlParameter, SqlRow, SqlRunResult } from './worker-types.js';

export interface SqlExecutor {
	exec(sql: string): Promise<void>;
	all(sql: string, params?: SqlParameter[]): Promise<SqlRow[]>;
	one(sql: string, params?: SqlParameter[]): Promise<SqlRow | null>;
	run(sql: string, params?: SqlParameter[]): Promise<SqlRunResult>;
}

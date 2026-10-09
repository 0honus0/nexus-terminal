import type { DatabaseSync as Database } from 'node:sqlite';

export interface SqliteMigration {
	id: number;
	name: string;
	sql: string; // 可以是多条 SQL 语句，用 ; 分隔。db.exec 会处理。
	check?: (db: Database) => Promise<boolean>; // 可选的前置检查函数
	apply?: (db: Database) => Promise<void>; // partial-schema migration 可逐 statement 恢复
	verify?: (db: Database) => Promise<boolean>; // 写 migrations 记录前的完整 postcondition
}

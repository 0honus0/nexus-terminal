import type { DatabaseSync as Database } from 'node:sqlite';
import { logger } from '../../shared/logging/logger';
import { definedMigrations } from './migrations/registry';

// 1. 定义 migrations 表 SQL
const createMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, -- 迁移的版本号
    name TEXT NOT NULL,     -- 迁移的描述性名称
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')) -- 应用迁移的时间戳
);
`;

/**
 * 运行数据库迁移。
 * 检查当前数据库版本，并按顺序应用所有新的迁移。
 * @param db 数据库实例
 */
export const runMigrations = async (db: Database): Promise<void> => {
	logger.info('[Migrations] 开始检查和应用数据库迁移...');

	db.exec(createMigrationsTableSQL);
	logger.info('[Migrations] migrations 表已确保存在。');

	const row = db.prepare('SELECT MAX(id) as currentVersion FROM migrations').get() as
		{ currentVersion: number | null } | undefined;
	const currentVersion = row?.currentVersion ?? 0;
	logger.info(`[Migrations] 当前数据库版本: ${currentVersion}`);

	const migrationsToApply = definedMigrations
		.filter((migration) => migration.id > currentVersion)
		.sort((a, b) => a.id - b.id);

	if (migrationsToApply.length === 0) {
		logger.info('[Migrations] 数据库已是最新版本，无需迁移。');
		return;
	}

	logger.info(
		{ migrations: migrationsToApply.map((migration) => ({ id: migration.id, name: migration.name })) },
		`Found ${migrationsToApply.length} database migration(s) to apply`,
	);

	const insertMigration = db.prepare(
		"INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%s', 'now'))",
	);

	for (const migration of migrationsToApply) {
		logger.info(`[Migrations] 应用迁移 #${migration.id}: ${migration.name}...`);
		db.exec('BEGIN TRANSACTION');

		try {
			let needsSqlExecution = true;
			if (migration.check) {
				logger.info(`[Migrations] 执行迁移 #${migration.id} 的前置检查...`);
				needsSqlExecution = await migration.check(db);
				logger.info(
					`[Migrations] 迁移 #${migration.id} 前置检查结果: ${needsSqlExecution ? '需要执行 SQL' : '跳过 SQL 执行'}`,
				);
			}

			if (needsSqlExecution) {
				logger.info(`[Migrations] 执行迁移 #${migration.id} 的 SQL...`);
				if (migration.apply) {
					await migration.apply(db);
				} else {
					try {
						db.exec(migration.sql);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (message.includes('duplicate column name')) {
							logger.warn(
								`[Migrations] 迁移 #${migration.id} SQL 执行时出现 'duplicate column name' 错误，视为可接受并继续。`,
							);
						} else {
							throw error;
						}
					}
				}
			}

			if (migration.verify && !(await migration.verify(db))) {
				throw new Error(`MIGRATION_POSTCONDITION_FAILED:${migration.id}`);
			}

			logger.info(`[Migrations] 记录迁移 #${migration.id} 到 migrations 表...`);
			insertMigration.run(migration.id, migration.name);
			db.exec('COMMIT');
			logger.info(`[Migrations] 迁移 #${migration.id}: ${migration.name} 应用成功 (SQL 可能已跳过)。`);
		} catch (error) {
			logger.error(`[Migrations] 迁移 #${migration.id} 步骤失败，正在回滚事务...`);
			try {
				db.exec('ROLLBACK');
			} catch (rollbackError) {
				logger.error(
					{ err: rollbackError, migrationId: migration.id },
					'Failed to roll back database migration',
				);
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`迁移 #${migration.id} 失败: ${message}`);
		}
	}

	logger.info('[Migrations] 所有新迁移已成功应用！');
};

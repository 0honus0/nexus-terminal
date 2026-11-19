import { constants, type DatabaseSync } from 'node:sqlite';

/** SQLite 在准备语句时报告实际读写的表，包括视图、触发器和外键产生的访问。 */
export function authorizePluginDatabase(db: DatabaseSync, tablePrefix: string): void {
	const owns = (name: string | null) => name?.toLowerCase().startsWith(tablePrefix) === true;

	const ownsIndex = (name: string | null) =>
		owns(name) || name?.toLowerCase().startsWith(`sqlite_autoindex_${tablePrefix}`) === true;

	const decide = (allowed: boolean) => (allowed ? constants.SQLITE_OK : constants.SQLITE_DENY);

	// SQLite 的 DDL 会更新系统目录。Defensive 模式阻止 SQL 直接修改目录。
	db.enableDefensive(true);
	db.setAuthorizer((action, name, target, schema) => {
		const isMain = schema === 'main';
		const catalog = name === 'sqlite_master' || name === 'sqlite_temp_master';
		switch (action) {
			case constants.SQLITE_SELECT:
			case constants.SQLITE_RECURSIVE:
			case constants.SQLITE_TRANSACTION:
			case constants.SQLITE_SAVEPOINT:
				return constants.SQLITE_OK;
			case constants.SQLITE_FUNCTION:
				// SQLite 的表改名事件只提供旧表名，禁止其内部改名函数绕过前缀校验。
				return decide(target !== 'load_extension' && target !== 'sqlite_rename_table');
			case constants.SQLITE_READ:
				// Kysely 的迁移和表结构检查需要读取 SQLite 系统目录。
				// SQLite 展开 CTE 后可能报告 schema 为 null 的表读取，仍按所有者校验。
				return decide(catalog || ((isMain || schema === null) && (owns(name) || name === 'pragma_table_info')));
			case constants.SQLITE_INSERT:
			case constants.SQLITE_UPDATE:
			case constants.SQLITE_DELETE:
				return decide(catalog || (isMain && owns(name)));
			case constants.SQLITE_CREATE_TABLE:
				return decide(isMain && (owns(name) || name === 'sqlite_sequence'));
			case constants.SQLITE_CREATE_VIEW:
			case constants.SQLITE_DROP_TABLE:
			case constants.SQLITE_DROP_VIEW:
				return decide(isMain && owns(name));
			case constants.SQLITE_CREATE_INDEX:
			case constants.SQLITE_DROP_INDEX:
				return decide(isMain && ownsIndex(name) && owns(target));
			case constants.SQLITE_REINDEX:
				return decide(isMain && ownsIndex(name));
			case constants.SQLITE_CREATE_TRIGGER:
			case constants.SQLITE_DROP_TRIGGER:
				return decide(isMain && owns(name) && owns(target));
			case constants.SQLITE_ALTER_TABLE:
				return decide(name === 'main' && owns(target));
			case constants.SQLITE_PRAGMA:
				if (name !== 'table_info' || (schema !== null && !isMain)) return constants.SQLITE_DENY;
				// 遍历系统目录时跳过其他插件的列定义。
				return owns(target) ? constants.SQLITE_OK : constants.SQLITE_IGNORE;
			default:
				return constants.SQLITE_DENY;
		}
	});
}

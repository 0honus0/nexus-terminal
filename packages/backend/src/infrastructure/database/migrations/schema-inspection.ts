import type { DatabaseSync as Database } from 'node:sqlite';

// 辅助函数：检查表是否存在
export const tableExists = async (db: Database, tableName: string): Promise<boolean> => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return Boolean(row);
};

// 辅助函数：检查列是否存在
export const columnExists = async (db: Database, tableName: string, columnName: string): Promise<boolean> => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
};

export const indexExists = async (db: Database, indexName: string): Promise<boolean> => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
  return Boolean(row);
};

// 辅助函数：获取表的创建 SQL
export const getTableCreateSQL = async (db: Database, tableName: string): Promise<string | null> => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as
    { sql?: string } | undefined;
  return row?.sql ?? null;
};

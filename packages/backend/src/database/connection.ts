import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { tableDefinitions } from './schema.registry';
import { runMigrations } from './migrations';

const dbDir = path.join(__dirname, '..', '..', 'data');
const dbFilename = 'nexus-terminal.db';
const dbPath = path.join(dbDir, dbFilename);

if (!fs.existsSync(dbDir)) {
    try {
        fs.mkdirSync(dbDir, { recursive: true });
    } catch (mkdirErr: any) {
        console.error(`[数据库文件系统] 创建目录 ${dbDir} 失败:`, mkdirErr.message);
        throw new Error(`创建数据库目录失败: ${mkdirErr.message}`);
    }
}

export type Database = DatabaseSync;

export interface RunResult {
    lastID: number;
    changes: number;
}

let dbInstancePromise: Promise<Database> | null = null;

const normalizeParams = (params: any[]): SQLInputValue[] => params as SQLInputValue[];

export const runDb = async (db: Database, sql: string, params: any[] = []): Promise<RunResult> => {
    try {
        const result = db.prepare(sql).run(...normalizeParams(params));
        return {
            lastID: Number(result.lastInsertRowid),
            changes: Number(result.changes),
        };
    } catch (error: any) {
        console.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 参数: ${JSON.stringify(params)} 错误: ${error.message}`);
        throw error;
    }
};

export const getDb = async <T = any>(db: Database, sql: string, params: any[] = []): Promise<T | undefined> => {
    try {
        return db.prepare(sql).get(...normalizeParams(params)) as T | undefined;
    } catch (error: any) {
        console.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 参数: ${JSON.stringify(params)} 错误: ${error.message}`);
        throw error;
    }
};

export const allDb = async <T = any>(db: Database, sql: string, params: any[] = []): Promise<T[]> => {
    try {
        return db.prepare(sql).all(...normalizeParams(params)) as T[];
    } catch (error: any) {
        console.error(`[数据库错误] SQL: ${sql.substring(0, 100)}... 参数: ${JSON.stringify(params)} 错误: ${error.message}`);
        throw error;
    }
};

const runDatabaseInitializations = async (db: Database): Promise<void> => {
    try {
        await runDb(db, 'PRAGMA foreign_keys = ON;');
        for (const tableDef of tableDefinitions) {
            db.exec(tableDef.sql);
            if (tableDef.init) {
                await tableDef.init(db);
            }
        }
    } catch (error) {
        console.error('[DB Init] 数据库初始化序列失败:', error);
        throw error;
    }
};

export const getDbInstance = (): Promise<Database> => {
    if (!dbInstancePromise) {
        dbInstancePromise = (async () => {
            let db: Database | null = null;
            try {
                db = new DatabaseSync(dbPath);
                await runDatabaseInitializations(db);
                await runMigrations(db);
                console.log('[数据库] 初始化和迁移完成。');
                return db;
            } catch (error: any) {
                dbInstancePromise = null;
                if (db) {
                    try {
                        db.close();
                    } catch (closeError: any) {
                        console.error('[数据库] 初始化失败后关闭连接时出错:', closeError.message);
                    }
                }
                console.error(`[数据库连接] 打开或初始化数据库文件 ${dbPath} 时出错:`, error.message);
                throw error;
            }
        })();
    }
    return dbInstancePromise;
};

process.on('SIGINT', async () => {
    if (!dbInstancePromise) {
        console.log('[DB] 收到 SIGINT，但数据库连接从未初始化或已失败。');
        process.exit(0);
    }

    console.log('[DB] 收到 SIGINT，尝试关闭数据库连接...');
    try {
        const db = await dbInstancePromise;
        db.close();
        console.log('[DB] 数据库连接已关闭。');
        process.exit(0);
    } catch (error: any) {
        console.error('[DB] 关闭数据库时出错:', error.message);
        process.exit(1);
    }
});

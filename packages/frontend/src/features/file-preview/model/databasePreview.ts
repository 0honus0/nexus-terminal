import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface DatabasePreviewColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

export interface DatabasePreviewTable {
  name: string;
}

export interface DatabasePreviewPage {
  rows: string[][];
  totalRows: number;
}

export interface DatabasePreviewController {
  tables: readonly DatabasePreviewTable[];
  columns(table: string): DatabasePreviewColumn[];
  page(table: string, offset: number, limit: number, search?: string): DatabasePreviewPage;
  close(): void;
}

let sqlRuntimePromise: Promise<SqlJsStatic> | null = null;

const loadSqlRuntime = (): Promise<SqlJsStatic> => {
  sqlRuntimePromise ??= initSqlJs({ locateFile: () => sqlWasmUrl });
  return sqlRuntimePromise;
};

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const firstResult = (database: Database, sql: string, params?: SqlValue[]) => database.exec(sql, params)[0];

const cellText = (value: SqlValue): string => {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) return `[BLOB ${value.byteLength} bytes]`;
  return String(value);
};

const tableSearchClause = (
  columns: readonly DatabasePreviewColumn[],
  search: string,
): { sql: string; params: string[] } => {
  const query = search.trim();
  if (!query || !columns.length) return { sql: '', params: [] };
  return {
    sql: ` WHERE ${columns.map((column) => `instr(lower(CAST(${quoteIdentifier(column.name)} AS TEXT)), lower(?)) > 0`).join(' OR ')}`,
    params: columns.map(() => query),
  };
};

class SqlitePreviewController implements DatabasePreviewController {
  readonly tables: readonly DatabasePreviewTable[];
  private readonly columnCache = new Map<string, DatabasePreviewColumn[]>();

  constructor(private readonly database: Database) {
    const result = firstResult(
      database,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE",
    );
    this.tables =
      result?.values
        .map((row) => row[0])
        .filter((name): name is string => typeof name === 'string')
        .map((name) => ({ name })) ?? [];
  }

  columns(table: string): DatabasePreviewColumn[] {
    const cached = this.columnCache.get(table);
    if (cached) return cached;

    const result = firstResult(this.database, `PRAGMA table_info(${quoteIdentifier(table)})`);
    const columns =
      result?.values.map((row) => ({
        name: String(row[1] ?? ''),
        type: String(row[2] ?? ''),
        notNull: Number(row[3] ?? 0) === 1,
        primaryKey: Number(row[5] ?? 0) > 0,
      })) ?? [];
    this.columnCache.set(table, columns);
    return columns;
  }

  page(table: string, offset: number, limit: number, search = ''): DatabasePreviewPage {
    const columns = this.columns(table);
    const searchClause = tableSearchClause(columns, search);
    const quotedTable = quoteIdentifier(table);
    const countResult = firstResult(
      this.database,
      `SELECT COUNT(*) FROM ${quotedTable}${searchClause.sql}`,
      searchClause.params,
    );
    const totalRows = Number(countResult?.values[0]?.[0] ?? 0);
    if (!totalRows) return { rows: [], totalRows: 0 };

    const pageResult = firstResult(this.database, `SELECT * FROM ${quotedTable}${searchClause.sql} LIMIT ? OFFSET ?`, [
      ...searchClause.params,
      Math.max(1, Math.trunc(limit)),
      Math.max(0, Math.trunc(offset)),
    ]);
    return {
      rows: pageResult?.values.map((row) => row.map(cellText)) ?? [],
      totalRows,
    };
  }

  close(): void {
    this.database.close();
  }
}

export const openDatabasePreview = async (bytes: ArrayBuffer): Promise<DatabasePreviewController> => {
  const runtime = await loadSqlRuntime();
  const database = new runtime.Database(new Uint8Array(bytes));
  try {
    database.run('PRAGMA query_only = ON');
    return new SqlitePreviewController(database);
  } catch (cause) {
    database.close();
    throw cause;
  }
};

import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  QuickCommand,
  QuickCommandRepository,
  QuickCommandSort,
} from '../../../modules/quick-commands/quick-command.repository.port';
type Row = {
  id: number;
  name: string | null;
  command: string;
  usage_count: number;
  variables: string | null;
  created_at: number;
  updated_at: number;
  tag_ids_str: string | null;
};
const map = (row: Row): QuickCommand => ({
  id: row.id,
  name: row.name,
  command: row.command,
  usage_count: row.usage_count,
  created_at: row.created_at,
  updated_at: row.updated_at,
  variables: parseVariables(row.variables),
  tagIds: row.tag_ids_str ? row.tag_ids_str.split(',').map(Number).filter(Number.isFinite) : [],
});
const parseVariables = (value: string | null): Record<string, string> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return null;
  }
};
const select = `SELECT qc.id,qc.name,qc.command,qc.usage_count,qc.variables,qc.created_at,qc.updated_at,GROUP_CONCAT(qta.tag_id) AS tag_ids_str FROM quick_commands qc LEFT JOIN quick_command_tag_associations qta ON qc.id=qta.quick_command_id`;
export class SqliteQuickCommandRepository implements QuickCommandRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async create(name: string | null, command: string, variables?: Record<string, string>): Promise<number> {
    const r = await this.db.execute(
      "INSERT INTO quick_commands (name,command,variables,created_at,updated_at) VALUES (?,?,?,strftime('%s','now'),strftime('%s','now'))",
      [name, command, variables ? JSON.stringify(variables) : null],
    );
    if (!r.lastInsertId) throw new Error('Quick command insert did not return an id.');
    return r.lastInsertId;
  }
  async update(id: number, name: string | null, command: string, variables?: Record<string, string>): Promise<boolean> {
    return (
      (
        await this.db.execute(
          "UPDATE quick_commands SET name=?,command=?,variables=?,updated_at=strftime('%s','now') WHERE id=?",
          [name, command, variables ? JSON.stringify(variables) : null, id],
        )
      ).changes > 0
    );
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM quick_commands WHERE id=?', [id])).changes > 0;
  }
  async list(sortBy: QuickCommandSort = 'name'): Promise<QuickCommand[]> {
    const order = sortBy === 'usage_count' ? 'qc.usage_count DESC,qc.name ASC' : 'qc.name ASC';
    return (await this.db.queryAll<Row>(`${select} GROUP BY qc.id ORDER BY ${order}`)).map(map);
  }
  async incrementUsage(id: number): Promise<boolean> {
    return (
      (
        await this.db.execute(
          "UPDATE quick_commands SET usage_count=usage_count+1,updated_at=strftime('%s','now') WHERE id=?",
          [id],
        )
      ).changes > 0
    );
  }
  async get(id: number): Promise<QuickCommand | null> {
    const row = await this.db.queryOne<Row>(`${select} WHERE qc.id=? GROUP BY qc.id`, [id]);
    return row ? map(row) : null;
  }
}

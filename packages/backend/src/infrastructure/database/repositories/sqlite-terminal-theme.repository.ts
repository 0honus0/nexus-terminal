import type { TerminalThemeRepository } from '../../../modules/terminal-themes/terminal-theme.repository.port';
import type {
  CreateTerminalThemeInput,
  TerminalTheme,
  TerminalThemeData,
  TerminalThemePreset,
  UpdateTerminalThemeInput,
} from '../../../modules/terminal-themes/terminal-theme.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface ThemeRow {
  id: number;
  name: string;
  theme_type: 'preset' | 'user';
  foreground: string | null;
  background: string | null;
  cursor: string | null;
  cursor_accent: string | null;
  selection_background: string | null;
  black: string | null;
  red: string | null;
  green: string | null;
  yellow: string | null;
  blue: string | null;
  magenta: string | null;
  cyan: string | null;
  white: string | null;
  bright_black: string | null;
  bright_red: string | null;
  bright_green: string | null;
  bright_yellow: string | null;
  bright_blue: string | null;
  bright_magenta: string | null;
  bright_cyan: string | null;
  bright_white: string | null;
  created_at: number;
  updated_at: number;
}

const themeColumns = [
  'foreground',
  'background',
  'cursor',
  'cursor_accent',
  'selection_background',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright_black',
  'bright_red',
  'bright_green',
  'bright_yellow',
  'bright_blue',
  'bright_magenta',
  'bright_cyan',
  'bright_white',
] as const;

const themeValues = (theme: TerminalThemeData): Array<string | null> => [
  theme.foreground ?? null,
  theme.background ?? null,
  theme.cursor ?? null,
  theme.cursorAccent ?? null,
  theme.selectionBackground ?? null,
  theme.black ?? null,
  theme.red ?? null,
  theme.green ?? null,
  theme.yellow ?? null,
  theme.blue ?? null,
  theme.magenta ?? null,
  theme.cyan ?? null,
  theme.white ?? null,
  theme.brightBlack ?? null,
  theme.brightRed ?? null,
  theme.brightGreen ?? null,
  theme.brightYellow ?? null,
  theme.brightBlue ?? null,
  theme.brightMagenta ?? null,
  theme.brightCyan ?? null,
  theme.brightWhite ?? null,
];

const mapRow = (row: ThemeRow): TerminalTheme => ({
  id: row.id,
  name: row.name,
  themeData: {
    foreground: row.foreground ?? undefined,
    background: row.background ?? undefined,
    cursor: row.cursor ?? undefined,
    cursorAccent: row.cursor_accent ?? undefined,
    selectionBackground: row.selection_background ?? undefined,
    black: row.black ?? undefined,
    red: row.red ?? undefined,
    green: row.green ?? undefined,
    yellow: row.yellow ?? undefined,
    blue: row.blue ?? undefined,
    magenta: row.magenta ?? undefined,
    cyan: row.cyan ?? undefined,
    white: row.white ?? undefined,
    brightBlack: row.bright_black ?? undefined,
    brightRed: row.bright_red ?? undefined,
    brightGreen: row.bright_green ?? undefined,
    brightYellow: row.bright_yellow ?? undefined,
    brightBlue: row.bright_blue ?? undefined,
    brightMagenta: row.bright_magenta ?? undefined,
    brightCyan: row.bright_cyan ?? undefined,
    brightWhite: row.bright_white ?? undefined,
  },
  isPreset: row.theme_type === 'preset',
  isSystemDefault: row.name === 'default',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const duplicateThemeError = (error: unknown, name: string): never => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('UNIQUE constraint failed')) throw new Error(`主题名称 "${name}" 已存在。`);
  throw error;
};

export class SqliteTerminalThemeRepository implements TerminalThemeRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async list(): Promise<TerminalTheme[]> {
    const rows = await this.database.queryAll<ThemeRow>(
      "SELECT * FROM terminal_themes ORDER BY CASE theme_type WHEN 'preset' THEN 0 ELSE 1 END, name ASC",
    );
    return rows.map(mapRow);
  }

  async get(id: number): Promise<TerminalTheme | null> {
    const row = await this.database.queryOne<ThemeRow>('SELECT * FROM terminal_themes WHERE id = ?', [id]);
    return row ? mapRow(row) : null;
  }

  async createUser(input: CreateTerminalThemeInput): Promise<TerminalTheme> {
    const now = Math.floor(Date.now() / 1000);
    try {
      const result = await this.database.execute(
        `INSERT INTO terminal_themes (name, theme_type, ${themeColumns.join(', ')}, created_at, updated_at)
         VALUES (?, 'user', ${themeColumns.map(() => '?').join(', ')}, ?, ?)`,
        [input.name, ...themeValues(input.themeData), now, now],
      );
      const created = await this.get(result.lastInsertId!);
      if (!created) throw new Error('创建主题后无法重新读取主题。');
      return created;
    } catch (error) {
      return duplicateThemeError(error, input.name);
    }
  }

  async updateUser(id: number, input: UpdateTerminalThemeInput): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
      const assignments = themeColumns.map((column) => `${column} = ?`).join(', ');
      const result = await this.database.execute(
        `UPDATE terminal_themes SET name = ?, ${assignments}, updated_at = ? WHERE id = ? AND theme_type = 'user'`,
        [input.name, ...themeValues(input.themeData), now, id],
      );
      return result.changes > 0;
    } catch (error) {
      return duplicateThemeError(error, input.name);
    }
  }

  async deleteUser(id: number): Promise<boolean> {
    return (
      (await this.database.execute("DELETE FROM terminal_themes WHERE id = ? AND theme_type = 'user'", [id])).changes >
      0
    );
  }

  async ensurePresets(presets: readonly TerminalThemePreset[]): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.database.transaction(async (database) => {
      for (const preset of presets) {
        const existing = await database.queryOne<{ id: number }>(
          "SELECT id FROM terminal_themes WHERE name = ? AND theme_type = 'preset'",
          [preset.name],
        );
        if (existing) continue;
        await database.execute(
          `INSERT INTO terminal_themes (name, theme_type, ${themeColumns.join(', ')}, created_at, updated_at)
           VALUES (?, 'preset', ${themeColumns.map(() => '?').join(', ')}, ?, ?)`,
          [preset.name, ...themeValues(preset.themeData), now, now],
        );
      }
    });
  }

  async findPresetIdByName(name: string): Promise<number | null> {
    const row = await this.database.queryOne<{ id: number }>(
      "SELECT id FROM terminal_themes WHERE name = ? AND theme_type = 'preset' LIMIT 1",
      [name],
    );
    return row?.id ?? null;
  }
}

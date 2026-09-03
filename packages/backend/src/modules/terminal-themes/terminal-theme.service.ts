import type { TerminalThemeRepository } from './terminal-theme.repository.port';
import type {
  CreateTerminalThemeInput,
  TerminalTheme,
  TerminalThemeData,
  TerminalThemePreset,
  UpdateTerminalThemeInput,
} from './terminal-theme.types';

const assertThemeId = (id: number): void => {
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的主题 ID');
};

const validateTheme = (name: string, themeData: TerminalThemeData): void => {
  if (!name?.trim()) throw new Error('主题名称不能为空');
  if (name.length > 255) throw new Error('主题名称过长');
  if (!themeData || typeof themeData.background !== 'string' || typeof themeData.foreground !== 'string') {
    throw new Error('无效的主题数据格式');
  }
};

/** Owns terminal-theme use cases; persistence and preset storage are injected. */
export class TerminalThemeService {
  constructor(private readonly repository: TerminalThemeRepository) {}

  initialize(presets: readonly TerminalThemePreset[]): Promise<void> {
    return this.repository.ensurePresets(presets);
  }

  list(): Promise<TerminalTheme[]> {
    return this.repository.list();
  }

  get(id: number): Promise<TerminalTheme | null> {
    assertThemeId(id);
    return this.repository.get(id);
  }

  create(input: CreateTerminalThemeInput): Promise<TerminalTheme> {
    validateTheme(input.name, input.themeData);
    return this.repository.createUser({ name: input.name.trim(), themeData: input.themeData });
  }

  async update(id: number, input: UpdateTerminalThemeInput): Promise<boolean> {
    assertThemeId(id);
    validateTheme(input.name, input.themeData);
    return this.repository.updateUser(id, { name: input.name.trim(), themeData: input.themeData });
  }

  async delete(id: number): Promise<boolean> {
    assertThemeId(id);
    return this.repository.deleteUser(id);
  }

  import(themeData: TerminalThemeData, name: string): Promise<TerminalTheme> {
    return this.create({ name, themeData });
  }

  async export(id: number): Promise<{ fileName: string; themeData: TerminalThemeData } | null> {
    const theme = await this.get(id);
    if (!theme) return null;
    return {
      fileName: `${theme.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`,
      themeData: theme.themeData,
    };
  }

  findDefaultThemeId(): Promise<number | null> {
    return this.repository.findPresetIdByName('default');
  }
}

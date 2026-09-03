import type {
  CreateTerminalThemeInput,
  TerminalTheme,
  TerminalThemePreset,
  UpdateTerminalThemeInput,
} from './terminal-theme.types';

export interface TerminalThemeRepository {
  list(): Promise<TerminalTheme[]>;
  get(id: number): Promise<TerminalTheme | null>;
  createUser(input: CreateTerminalThemeInput): Promise<TerminalTheme>;
  updateUser(id: number, input: UpdateTerminalThemeInput): Promise<boolean>;
  deleteUser(id: number): Promise<boolean>;
  ensurePresets(presets: readonly TerminalThemePreset[]): Promise<void>;
  findPresetIdByName(name: string): Promise<number | null>;
}

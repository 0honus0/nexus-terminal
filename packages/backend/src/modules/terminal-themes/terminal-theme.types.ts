export type TerminalThemeData = Record<string, string | undefined>;

/** User-visible terminal theme model. */
export interface TerminalTheme {
  id: number;
  name: string;
  themeData: TerminalThemeData;
  isPreset: boolean;
  isSystemDefault?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateTerminalThemeInput {
  name: string;
  themeData: TerminalThemeData;
}

export interface UpdateTerminalThemeInput {
  name: string;
  themeData: TerminalThemeData;
}

export interface TerminalThemePreset {
  name: string;
  themeData: TerminalThemeData;
  isPreset: true;
  isSystemDefault?: boolean;
  preset_key?: string;
}

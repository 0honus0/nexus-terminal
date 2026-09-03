export interface TerminalThemeData {
  foreground: string;
  background: string;
  [key: string]: string | undefined;
}

export interface TerminalTheme {
  id: number;
  name: string;
  data: TerminalThemeData;
  preset: boolean;
}

export interface TerminalThemeService {
  list(): Promise<TerminalTheme[]>;
  get(id: number): Promise<TerminalTheme | null>;
}

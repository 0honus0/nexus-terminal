import type {
  AppearanceSettingsDto,
  LocalHtmlThemeDto,
  RemoteHtmlThemeDto,
  TerminalThemeDto,
} from '@nexus-terminal/protocol/appearance';

export type AppearanceSettings = Omit<Partial<AppearanceSettingsDto>, 'terminalCustomHtml'> & {
  terminalCustomHtml?: string | null;
};

export type TerminalTheme = TerminalThemeDto;
export type LocalHtmlTheme = LocalHtmlThemeDto;
export type RemoteHtmlTheme = RemoteHtmlThemeDto;

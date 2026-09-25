import type { LogLevelDto, PreferencesDto, PreferencesPatchDto } from '@nexus-terminal/protocol/settings';
export type { LogLevelDto, PreferencesDto, PreferencesPatchDto };

export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'silent',
] as const satisfies readonly LogLevelDto[];
export type PreferenceKey = keyof PreferencesDto;
export const defaultPreferences: PreferencesDto = {
  language: 'en-US',
  frontendLogLevel: 'info',
  backendLogLevel: 'info',
  timezone: 'UTC',
  showPopupFileEditor: true,
  shareFileEditorTabs: true,
  showPopupFileManager: false,
  dockerStatusIntervalSeconds: 5,
  dockerDefaultExpand: false,
  statusMonitorIntervalSeconds: 3,
  remoteHostRefreshIntervalSeconds: 30,
  statusMonitorScale: 1,
  dashboardShowLocalResources: true,
  dashboardShowRemoteResources: true,
  workspaceSidebarPersistent: false,
  terminalScrollbackLimit: 5000,
  showStatusMonitorIpAddress: false,
  commandInputSyncTarget: 'none',
  quickCommandsCollapsibleSearch: false,
  quickCommandsCompactMode: false,
  quickCommandRowSizeMultiplier: 1,
  terminalRightClickCopyPaste: true,
  layoutLocked: false,
  navBarVisible: true,
  fileManagerShowDeleteConfirmation: true,
  sidebarPaneWidths: {},
  fileManagerRowSizeMultiplier: 1,
  fileManagerColWidths: { name: 200, permissions: 76, modified: 92 },
  spreadsheetPreviewRowsPerPage: 500,
  spreadsheetPreviewMaxColumns: 100,
  rdpModalWidth: 1064,
  rdpModalHeight: 858,
  vncModalWidth: 1024,
  vncModalHeight: 768,
  showConnectionTags: true,
  showQuickCommandTags: true,
};

export const preferenceLanguageNames: Readonly<Record<string, string>> = {
  'en-US': 'English',
  'zh-CN': '中文',
  'ja-JP': '日本語',
};

export const commonTimezones = [
  'UTC',
  'Etc/GMT+12',
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Caracas',
  'America/Halifax',
  'America/Sao_Paulo',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Etc/GMT-14',
] as const;

export const terminalScrollbackForRuntime = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 5000;
  return Math.min(Math.floor(value), 100000);
};

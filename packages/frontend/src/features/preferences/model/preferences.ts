export interface Preferences {
  language: string;
  timezone: string;
  showPopupFileEditor: boolean;
  shareFileEditorTabs: boolean;
  showPopupFileManager: boolean;
  dockerStatusIntervalSeconds: number;
  dockerDefaultExpand: boolean;
  statusMonitorIntervalSeconds: number;
  remoteHostRefreshIntervalSeconds: number;
  statusMonitorScale: number;
  dashboardShowLocalResources: boolean;
  dashboardShowRemoteResources: boolean;
  workspaceSidebarPersistent: boolean;
  terminalScrollbackLimit: number;
  showStatusMonitorIpAddress: boolean;
  commandInputSyncTarget: 'none' | 'quickCommands' | 'commandHistory';
  quickCommandsCollapsibleSearch: boolean;
  quickCommandsCompactMode: boolean;
  quickCommandRowSizeMultiplier: number;
  terminalRightClickCopyPaste: boolean;
  layoutLocked: boolean;
  navBarVisible: boolean;
  fileManagerShowDeleteConfirmation: boolean;
  sidebarPaneWidths: Record<string, string>;
  fileManagerRowSizeMultiplier: number;
  fileManagerColWidths: Record<string, number>;
  spreadsheetPreviewRowsPerPage: number;
  spreadsheetPreviewMaxColumns: number;
  rdpModalWidth: number;
  rdpModalHeight: number;
  vncModalWidth: number;
  vncModalHeight: number;
  showConnectionTags: boolean;
  showQuickCommandTags: boolean;
}

export type PreferenceKey = keyof Preferences;
export type PreferencePatch = Partial<Preferences>;

export const defaultPreferences: Preferences = {
  language: 'en-US',
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
  workspaceSidebarPersistent: true,
  terminalScrollbackLimit: 5000,
  showStatusMonitorIpAddress: true,
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
  fileManagerColWidths: { type: 50, name: 300, size: 100, permissions: 120, modified: 180 },
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

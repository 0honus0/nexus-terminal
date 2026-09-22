import type { IpAccessSettingsDto } from './auth.js';

export type LogLevelDto = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type CommandInputSyncTargetDto = 'none' | 'quickCommands' | 'commandHistory';

export interface PreferencesDto {
  language: string;
  frontendLogLevel: LogLevelDto;
  backendLogLevel: LogLevelDto;
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
  commandInputSyncTarget: CommandInputSyncTargetDto;
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

export type PreferencesPatchDto = Partial<PreferencesDto>;
export type SettingsResponseDto = Partial<PreferencesDto> & IpAccessSettingsDto;
export type SettingsUpdateRequestDto = PreferencesPatchDto & IpAccessSettingsDto;

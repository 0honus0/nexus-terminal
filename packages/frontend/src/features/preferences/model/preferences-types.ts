import type { ComputedRef } from 'vue';
import type {
	PreferenceLanguage,
	FrontendLogLevel,
	WorkspacePane,
	CommandInputSyncTarget,
} from '@nexus-terminal/shared/preferences/presentation/values';
import { FRONTEND_LOG_LEVELS } from '@nexus-terminal/shared/preferences/presentation/values';

export interface UserPreferences {
	language: PreferenceLanguage;
	frontendLogLevel: FrontendLogLevel;
	timezone: string;
	showPopupFileEditor: boolean;
	shareFileEditorTabs: boolean;
	showPopupFileManager: boolean;
	showCommandBarClear: boolean;
	showCommandBarFocusSwitch: boolean;
	showCommandBarEditor: boolean;
	showCommandBarSearch: boolean;
	dockerStatusIntervalSeconds: number;
	dockerDefaultExpand: boolean;
	statusMonitorScale: number;
	dashboardShowLocalResources: boolean;
	dashboardShowRemoteResources: boolean;
	workspaceSidebarPersistent: boolean;
	terminalScrollbackLimit: number;
	showStatusMonitorIpAddress: boolean;
	commandInputSyncTarget: CommandInputSyncTarget;
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

export type PreferencesPatch = Partial<UserPreferences>;

export type PreferenceKey = keyof UserPreferences;

export const LOG_LEVELS = FRONTEND_LOG_LEVELS;

export type PanelScaleKind = 'status' | 'files' | 'quick-commands';

export type WorkspacePreferenceKey = 'layoutLocked' | 'navBarVisible';

export interface PreferencesController {
	savePanelScale(kind: PanelScaleKind, scale: number, permission: AbortSignal): Promise<void>;
	saveWorkspacePreference(key: WorkspacePreferenceKey, value: boolean, permission: AbortSignal): Promise<void>;
	values: ComputedRef<UserPreferences>;
	version: ComputedRef<number>;
	loaded: ComputedRef<boolean>;
	load(force?: boolean, fallbackLanguage?: string): Promise<UserPreferences>;
	update(patch: PreferencesPatch, expectedVersion?: number, permission?: AbortSignal): Promise<void>;
	reset(): void;
}

export type PersonalLayout =
	| { type: 'pane'; id: string; size: number; component: WorkspacePane }
	| { type: 'container'; id: string; size: number; direction: 'horizontal' | 'vertical'; children: PersonalLayout[] };

export interface PersonalFocus {
	sequence: string[];
	shortcuts: Record<string, string>;
}

export interface PersonalSidebar {
	left: WorkspacePane[];
	right: WorkspacePane[];
}

export interface UserPresentation {
	version: number;
	preferences: UserPreferences;
	layout: PersonalLayout;
	focus: PersonalFocus;
	sidebar: PersonalSidebar;
}

export type PresentationChange = { expectedVersion: number } & (
	| { action: 'preferences'; preferences: UserPreferences }
	| { action: 'layout'; layout: PersonalLayout }
	| { action: 'focus'; focus: PersonalFocus }
	| { action: 'sidebar'; sidebar: PersonalSidebar }
	| { action: 'workspace'; layout: PersonalLayout; sidebar: PersonalSidebar }
);

export const defaultPreferences: UserPreferences = {
	language: 'en-US',
	frontendLogLevel: 'info',
	timezone: 'UTC',
	showPopupFileEditor: true,
	shareFileEditorTabs: true,
	showPopupFileManager: false,
	showCommandBarClear: true,
	showCommandBarFocusSwitch: true,
	showCommandBarEditor: true,
	showCommandBarSearch: true,
	dockerStatusIntervalSeconds: 5,
	dockerDefaultExpand: false,
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

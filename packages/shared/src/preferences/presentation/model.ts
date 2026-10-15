import type { PreferenceLanguage, FrontendLogLevel, CommandInputSyncTarget, WorkspacePane } from './values.js';

export interface PresentationPreferences {
	language: PreferenceLanguage;
	frontendLogLevel: FrontendLogLevel;
	timezone: string;
	showPopupFileEditor: boolean;
	shareFileEditorTabs: boolean;
	showPopupFileManager: boolean;
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

export type PresentationLayout =
	| { type: 'pane'; id: string; size: number; component: WorkspacePane }
	| {
			type: 'container';
			id: string;
			size: number;
			direction: 'horizontal' | 'vertical';
			children: PresentationLayout[];
	  };

export interface PresentationFocus {
	sequence: string[];
	shortcuts: Record<string, string>;
}

export interface PresentationSidebar {
	left: WorkspacePane[];
	right: WorkspacePane[];
}

export interface PresentationData {
	preferences: PresentationPreferences;
	layout: PresentationLayout;
	focus: PresentationFocus;
	sidebar: PresentationSidebar;
}

export interface PresentationView {
	version: number;
	value: PresentationData;
}

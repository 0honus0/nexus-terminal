import type {
	PreferenceLanguage,
	FrontendLogLevel,
	CommandInputSyncTarget,
	WorkspacePane,
} from '@nexus-terminal/shared/preferences/presentation/values';

export interface StoredPresentationPreferences {
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

export type StoredPresentationLayout =
	| { type: 'pane'; id: string; size: number; component: WorkspacePane }
	| {
			type: 'container';
			id: string;
			size: number;
			direction: 'horizontal' | 'vertical';
			children: StoredPresentationLayout[];
	  };

export interface StoredPresentationFocus {
	sequence: string[];
	shortcuts: Record<string, string>;
}

export interface StoredPresentationSidebar {
	left: WorkspacePane[];
	right: WorkspacePane[];
}

export interface StoredPresentationData {
	preferences: StoredPresentationPreferences;
	layout: StoredPresentationLayout;
	focus: StoredPresentationFocus;
	sidebar: StoredPresentationSidebar;
}

export interface StoredPresentationView {
	version: number;
	value: StoredPresentationData;
}

export interface PresentationAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface PresentationStorage {
	get(userId: number): Promise<StoredPresentationView | null>;
	update(
		userId: number,
		expectedVersion: number,
		value: StoredPresentationData,
		authorization: PresentationAuthorization,
	): Promise<StoredPresentationView | null>;
}

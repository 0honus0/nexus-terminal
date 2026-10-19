import type {
	PresentationView,
	PresentationPreferences,
	PresentationLayout,
	PresentationFocus,
	PresentationSidebar,
} from '@nexus-terminal/shared/preferences/presentation/model';
import type {
	UserPreferences,
	PersonalLayout,
	PersonalFocus,
	PersonalSidebar,
	UserPresentation,
	PresentationChange,
} from './preferences-types';

export function projectPreferences(value: UserPreferences | PresentationPreferences): UserPreferences {
	return {
		language: value.language,
		frontendLogLevel: value.frontendLogLevel,
		timezone: value.timezone,
		showPopupFileEditor: value.showPopupFileEditor,
		shareFileEditorTabs: value.shareFileEditorTabs,
		showPopupFileManager: value.showPopupFileManager,
		dockerStatusIntervalSeconds: value.dockerStatusIntervalSeconds,
		dockerDefaultExpand: value.dockerDefaultExpand,
		statusMonitorScale: value.statusMonitorScale,
		dashboardShowLocalResources: value.dashboardShowLocalResources,
		dashboardShowRemoteResources: value.dashboardShowRemoteResources,
		workspaceSidebarPersistent: value.workspaceSidebarPersistent,
		terminalScrollbackLimit: value.terminalScrollbackLimit,
		showStatusMonitorIpAddress: value.showStatusMonitorIpAddress,
		commandInputSyncTarget: value.commandInputSyncTarget,
		quickCommandsCollapsibleSearch: value.quickCommandsCollapsibleSearch,
		quickCommandsCompactMode: value.quickCommandsCompactMode,
		quickCommandRowSizeMultiplier: value.quickCommandRowSizeMultiplier,
		terminalRightClickCopyPaste: value.terminalRightClickCopyPaste,
		layoutLocked: value.layoutLocked,
		navBarVisible: value.navBarVisible,
		fileManagerShowDeleteConfirmation: value.fileManagerShowDeleteConfirmation,
		sidebarPaneWidths: Object.fromEntries(
			Object.entries(value.sidebarPaneWidths).map(([name, width]) => [name, width]),
		),
		fileManagerRowSizeMultiplier: value.fileManagerRowSizeMultiplier,
		fileManagerColWidths: Object.fromEntries(
			Object.entries(value.fileManagerColWidths).map(([name, width]) => [name, width]),
		),
		spreadsheetPreviewRowsPerPage: value.spreadsheetPreviewRowsPerPage,
		spreadsheetPreviewMaxColumns: value.spreadsheetPreviewMaxColumns,
		rdpModalWidth: value.rdpModalWidth,
		rdpModalHeight: value.rdpModalHeight,
		vncModalWidth: value.vncModalWidth,
		vncModalHeight: value.vncModalHeight,
		showConnectionTags: value.showConnectionTags,
		showQuickCommandTags: value.showQuickCommandTags,
	};
}

export function projectLayout(value: PersonalLayout | PresentationLayout): PersonalLayout {
	if (value.type === 'pane') return { type: 'pane', id: value.id, size: value.size, component: value.component };
	return {
		type: 'container',
		id: value.id,
		size: value.size,
		direction: value.direction,
		children: value.children.map(projectLayout),
	};
}

export function projectFocus(value: PersonalFocus | PresentationFocus): PersonalFocus {
	return {
		sequence: value.sequence.map((entry) => entry),
		shortcuts: Object.fromEntries(Object.entries(value.shortcuts).map(([id, shortcut]) => [id, shortcut])),
	};
}

export function projectSidebar(value: PersonalSidebar | PresentationSidebar): PersonalSidebar {
	return { left: value.left.map((pane) => pane), right: value.right.map((pane) => pane) };
}

export function fromPresentation(value: PresentationView): UserPresentation {
	return {
		version: value.version,
		preferences: projectPreferences(value.value.preferences),
		layout: projectLayout(value.value.layout),
		focus: projectFocus(value.value.focus),
		sidebar: projectSidebar(value.value.sidebar),
	};
}

export function snapshotPresentationChange(value: PresentationChange): PresentationChange {
	const expectedVersion = value.expectedVersion;
	switch (value.action) {
		case 'preferences':
			return { action: 'preferences', expectedVersion, preferences: projectPreferences(value.preferences) };
		case 'layout':
			return { action: 'layout', expectedVersion, layout: projectLayout(value.layout) };
		case 'focus':
			return { action: 'focus', expectedVersion, focus: projectFocus(value.focus) };
		case 'sidebar':
			return { action: 'sidebar', expectedVersion, sidebar: projectSidebar(value.sidebar) };
		case 'workspace':
			return {
				action: 'workspace',
				expectedVersion,
				layout: projectLayout(value.layout),
				sidebar: projectSidebar(value.sidebar),
			};
	}
}

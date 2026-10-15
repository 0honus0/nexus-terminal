import type {
	PresentationPreferences as WirePresentationPreferences,
	PresentationLayout as WirePresentationLayout,
	PresentationFocus as WirePresentationFocus,
	PresentationSidebar as WirePresentationSidebar,
	PresentationData as WirePresentationData,
} from '@nexus-terminal/shared/preferences/presentation/model';
import type {
	PresentationPreferences,
	PresentationLayout,
	PresentationFocus,
	PresentationSidebar,
	PresentationData,
} from '../../presentation/model/presentation-types.js';

export function toApplicationPreferences(value: WirePresentationPreferences): PresentationPreferences {
	const sidebarPaneWidths: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.sidebarPaneWidths)) {
		sidebarPaneWidths[key] = entry;
	}
	const fileManagerColWidths: Record<string, number> = {};
	for (const [key, entry] of Object.entries(value.fileManagerColWidths)) {
		fileManagerColWidths[key] = entry;
	}
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
		sidebarPaneWidths: sidebarPaneWidths,
		fileManagerRowSizeMultiplier: value.fileManagerRowSizeMultiplier,
		fileManagerColWidths: fileManagerColWidths,
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

export function toApplicationLayout(value: WirePresentationLayout): PresentationLayout {
	if (value.type === 'pane') {
		return { type: 'pane', id: value.id, size: value.size, component: value.component };
	}
	return {
		type: 'container',
		id: value.id,
		size: value.size,
		direction: value.direction,
		children: value.children.map(toApplicationLayout),
	};
}

export function toApplicationFocus(value: WirePresentationFocus): PresentationFocus {
	const shortcuts: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.shortcuts)) {
		Object.defineProperty(shortcuts, key, { value: entry, enumerable: true });
	}
	return { sequence: value.sequence.map((entry) => entry), shortcuts };
}

export function toApplicationSidebar(value: WirePresentationSidebar): PresentationSidebar {
	return { left: value.left.map((entry) => entry), right: value.right.map((entry) => entry) };
}

export function toWirePreferences(value: PresentationPreferences): WirePresentationPreferences {
	const sidebarPaneWidths: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.sidebarPaneWidths)) {
		sidebarPaneWidths[key] = entry;
	}
	const fileManagerColWidths: Record<string, number> = {};
	for (const [key, entry] of Object.entries(value.fileManagerColWidths)) {
		fileManagerColWidths[key] = entry;
	}
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
		sidebarPaneWidths: sidebarPaneWidths,
		fileManagerRowSizeMultiplier: value.fileManagerRowSizeMultiplier,
		fileManagerColWidths: fileManagerColWidths,
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

export function toWireLayout(value: PresentationLayout): WirePresentationLayout {
	if (value.type === 'pane') {
		return { type: 'pane', id: value.id, size: value.size, component: value.component };
	}
	return {
		type: 'container',
		id: value.id,
		size: value.size,
		direction: value.direction,
		children: value.children.map(toWireLayout),
	};
}

export function toWireFocus(value: PresentationFocus): WirePresentationFocus {
	const shortcuts: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.shortcuts)) {
		Object.defineProperty(shortcuts, key, { value: entry, enumerable: true });
	}
	return { sequence: value.sequence.map((entry) => entry), shortcuts };
}

export function toWireSidebar(value: PresentationSidebar): WirePresentationSidebar {
	return { left: value.left.map((entry) => entry), right: value.right.map((entry) => entry) };
}

export function toWireData(value: PresentationData): WirePresentationData {
	return {
		preferences: toWirePreferences(value.preferences),
		layout: toWireLayout(value.layout),
		focus: toWireFocus(value.focus),
		sidebar: toWireSidebar(value.sidebar),
	};
}

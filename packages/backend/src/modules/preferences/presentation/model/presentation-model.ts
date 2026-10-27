import type {
	PresentationStorage,
	StoredPresentationPreferences,
	StoredPresentationLayout,
	StoredPresentationFocus,
	StoredPresentationSidebar,
	StoredPresentationData,
} from '../storage/presentation-storage.js';
import type {
	PresentationView,
	PresentationPreferences,
	PresentationLayout,
	PresentationFocus,
	PresentationSidebar,
	PresentationData,
	PresentationActor,
	PresentationIdentity,
} from './presentation-types.js';

import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { PresentationFailure } from '../../presentation-failure.js';

function fromStoragePreferences(value: StoredPresentationPreferences): PresentationPreferences {
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
		showWorkspaceSuspendedSessions: value.showWorkspaceSuspendedSessions,
		showWorkspaceHeaderToggle: value.showWorkspaceHeaderToggle,
		showWorkspaceProgress: value.showWorkspaceProgress,
		showWorkspaceLayoutConfigurator: value.showWorkspaceLayoutConfigurator,
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

function fromStorageLayout(value: StoredPresentationLayout): PresentationLayout {
	if (value.type === 'pane') {
		return { type: 'pane', id: value.id, size: value.size, component: value.component };
	}
	return {
		type: 'container',
		id: value.id,
		size: value.size,
		direction: value.direction,
		children: value.children.map(fromStorageLayout),
	};
}

function fromStorageFocus(value: StoredPresentationFocus): PresentationFocus {
	const shortcuts: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.shortcuts)) {
		Object.defineProperty(shortcuts, key, { value: entry, enumerable: true });
	}
	return { sequence: value.sequence.map((entry) => entry), shortcuts };
}

function fromStorageSidebar(value: StoredPresentationSidebar): PresentationSidebar {
	return { left: value.left.map((entry) => entry), right: value.right.map((entry) => entry) };
}

function fromStorageData(value: StoredPresentationData): PresentationData {
	return {
		preferences: fromStoragePreferences(value.preferences),
		layout: fromStorageLayout(value.layout),
		focus: fromStorageFocus(value.focus),
		sidebar: fromStorageSidebar(value.sidebar),
	};
}

function toStoragePreferences(value: PresentationPreferences): StoredPresentationPreferences {
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
		showWorkspaceSuspendedSessions: value.showWorkspaceSuspendedSessions,
		showWorkspaceHeaderToggle: value.showWorkspaceHeaderToggle,
		showWorkspaceProgress: value.showWorkspaceProgress,
		showWorkspaceLayoutConfigurator: value.showWorkspaceLayoutConfigurator,
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

function toStorageLayout(value: PresentationLayout): StoredPresentationLayout {
	if (value.type === 'pane') {
		return { type: 'pane', id: value.id, size: value.size, component: value.component };
	}
	return {
		type: 'container',
		id: value.id,
		size: value.size,
		direction: value.direction,
		children: value.children.map(toStorageLayout),
	};
}

function toStorageFocus(value: PresentationFocus): StoredPresentationFocus {
	const shortcuts: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value.shortcuts)) {
		Object.defineProperty(shortcuts, key, { value: entry, enumerable: true });
	}
	return { sequence: value.sequence.map((entry) => entry), shortcuts };
}

function toStorageSidebar(value: PresentationSidebar): StoredPresentationSidebar {
	return { left: value.left.map((entry) => entry), right: value.right.map((entry) => entry) };
}

function toStorageData(value: PresentationData): StoredPresentationData {
	return {
		preferences: toStoragePreferences(value.preferences),
		layout: toStorageLayout(value.layout),
		focus: toStorageFocus(value.focus),
		sidebar: toStorageSidebar(value.sidebar),
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof PresentationFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new PresentationFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new PresentationFailure('internal_failure', { cause });
	}
}

export class PresentationModel {
	constructor(
		private readonly storage: PresentationStorage,
		private readonly tokens: SessionTokens,
	) {}

	async get(userId: number): Promise<PresentationView | null> {
		const saved = await storage(() => this.storage.get(userId));
		return saved === null ? null : { version: saved.version, value: fromStorageData(saved.value) };
	}

	async update(
		actor: PresentationActor,
		expectedVersion: number,
		value: PresentationData,
		admit: (identity: PresentationIdentity) => void,
	): Promise<PresentationView | null> {
		const command = toStorageData(value);
		const saved = await storage(() =>
			this.storage.update(actor.userId, expectedVersion, command, {
				sessionDigest: this.tokens.digest(actor.token),

				admit: (userId) => admit({ userId }),
			}),
		);
		if (saved === null) {
			return null;
		}
		try {
			return { version: saved.version, value: fromStorageData(saved.value) };
		} catch (cause) {
			throw new PresentationFailure('operation_unknown', { cause });
		}
	}
}

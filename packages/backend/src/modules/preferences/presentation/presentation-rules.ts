import {
	PREFERENCE_LANGUAGES,
	DESKTOP_WINDOW_MIN_WIDTH,
	DESKTOP_WINDOW_MIN_HEIGHT,
	DESKTOP_WINDOW_MAX_DIMENSION,
	FRONTEND_LOG_LEVELS,
	COMMAND_INPUT_SYNC_TARGETS,
	WORKSPACE_PANES,
	PRESENTATION_LAYOUT_MAX_DEPTH,
	PRESENTATION_LAYOUT_MAX_NODES,
} from '@nexus-terminal/shared/preferences/presentation/values';
import type { PresentationData, PresentationLayout } from './model/presentation-types.js';
import { PresentationFailure } from '../presentation-failure.js';

export function validatePresentation(value: PresentationData): void {
	const prefs = value.preferences;
	if (
		!PREFERENCE_LANGUAGES.includes(prefs.language) ||
		!FRONTEND_LOG_LEVELS.includes(prefs.frontendLogLevel) ||
		!COMMAND_INPUT_SYNC_TARGETS.includes(prefs.commandInputSyncTarget)
	) {
		throw new PresentationFailure('invalid_input');
	}
	try {
		new Intl.DateTimeFormat('en', { timeZone: prefs.timezone });
	} catch (cause) {
		throw new PresentationFailure('invalid_input', { cause });
	}

	const integer = (value: number, min: number, max: number) =>
		Number.isSafeInteger(value) && value >= min && value <= max;

	if (
		!integer(prefs.terminalScrollbackLimit, 0, 100000) ||
		!integer(prefs.dockerStatusIntervalSeconds, 1, 86400) ||
		!integer(prefs.spreadsheetPreviewRowsPerPage, 10, 2000) ||
		!integer(prefs.spreadsheetPreviewMaxColumns, 5, 200)
	) {
		throw new PresentationFailure('invalid_input');
	}

	const number = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

	if (
		typeof prefs.showPopupFileEditor !== 'boolean' ||
		typeof prefs.shareFileEditorTabs !== 'boolean' ||
		typeof prefs.showPopupFileManager !== 'boolean' ||
		typeof prefs.showWorkspaceSuspendedSessions !== 'boolean' ||
		typeof prefs.showWorkspaceHeaderToggle !== 'boolean' ||
		typeof prefs.showWorkspaceProgress !== 'boolean' ||
		typeof prefs.showWorkspaceLayoutConfigurator !== 'boolean' ||
		typeof prefs.dockerDefaultExpand !== 'boolean' ||
		!number(prefs.statusMonitorScale, 0.65, 1.6) ||
		typeof prefs.dashboardShowLocalResources !== 'boolean' ||
		typeof prefs.dashboardShowRemoteResources !== 'boolean' ||
		typeof prefs.workspaceSidebarPersistent !== 'boolean' ||
		typeof prefs.showStatusMonitorIpAddress !== 'boolean' ||
		typeof prefs.quickCommandsCollapsibleSearch !== 'boolean' ||
		typeof prefs.quickCommandsCompactMode !== 'boolean' ||
		!number(prefs.quickCommandRowSizeMultiplier, 0.5, 2.5) ||
		typeof prefs.terminalRightClickCopyPaste !== 'boolean' ||
		typeof prefs.layoutLocked !== 'boolean' ||
		typeof prefs.navBarVisible !== 'boolean' ||
		typeof prefs.fileManagerShowDeleteConfirmation !== 'boolean' ||
		!number(prefs.fileManagerRowSizeMultiplier, 0.5, 2) ||
		!integer(prefs.rdpModalWidth, DESKTOP_WINDOW_MIN_WIDTH, DESKTOP_WINDOW_MAX_DIMENSION) ||
		!integer(prefs.rdpModalHeight, DESKTOP_WINDOW_MIN_HEIGHT, DESKTOP_WINDOW_MAX_DIMENSION) ||
		!integer(prefs.vncModalWidth, DESKTOP_WINDOW_MIN_WIDTH, DESKTOP_WINDOW_MAX_DIMENSION) ||
		!integer(prefs.vncModalHeight, DESKTOP_WINDOW_MIN_HEIGHT, DESKTOP_WINDOW_MAX_DIMENSION) ||
		typeof prefs.showConnectionTags !== 'boolean' ||
		typeof prefs.showQuickCommandTags !== 'boolean'
	) {
		throw new PresentationFailure('invalid_input');
	}

	const ids = new Set<string>();
	const panes = new Set<string>();
	let count = 0;

	function layout(node: PresentationLayout, depth: number): void {
		if (
			depth > PRESENTATION_LAYOUT_MAX_DEPTH ||
			++count > PRESENTATION_LAYOUT_MAX_NODES ||
			!node.id ||
			ids.has(node.id) ||
			!Number.isFinite(node.size) ||
			node.size < 0 ||
			node.size > 100
		) {
			throw new PresentationFailure('invalid_input');
		}
		ids.add(node.id);
		if (node.type === 'pane') {
			if (!WORKSPACE_PANES.includes(node.component) || panes.has(node.component)) {
				throw new PresentationFailure('invalid_input');
			}
			panes.add(node.component);
			return;
		}
		if (!node.children.length) {
			throw new PresentationFailure('invalid_input');
		}
		for (const child of node.children) {
			layout(child, depth + 1);
		}
	}

	layout(value.layout, 0);
	const sidebar = [...value.sidebar.left, ...value.sidebar.right];
	if (new Set(sidebar).size !== sidebar.length || sidebar.some((pane) => !WORKSPACE_PANES.includes(pane))) {
		throw new PresentationFailure('invalid_input');
	}
	if (
		value.focus.sequence.length > 32 ||
		new Set(value.focus.sequence).size !== value.focus.sequence.length ||
		Object.keys(value.focus.shortcuts).some((key) => !value.focus.sequence.includes(key))
	) {
		throw new PresentationFailure('invalid_input');
	}
}

import type {
	StoredPresentationPreferences,
	StoredPresentationLayout,
	StoredPresentationFocus,
	StoredPresentationSidebar,
	StoredPresentationData,
	StoredPresentationView,
} from '../../storage/presentation-storage.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import {
	PREFERENCE_LANGUAGES,
	FRONTEND_LOG_LEVELS,
	COMMAND_INPUT_SYNC_TARGETS,
	WORKSPACE_PANES,
	PRESENTATION_RESPONSE_MAX_BYTES,
	PRESENTATION_LAYOUT_MAX_DEPTH,
	PRESENTATION_LAYOUT_MAX_NODES,
} from '@nexus-terminal/shared/preferences/presentation/values';
class CorruptPresentationRecord extends Error {
	constructor() {
		super('Corrupt presentation record');
	}
}

function object(input: unknown, keys?: readonly string[]): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new CorruptPresentationRecord();
	}
	if (keys && (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key)))) {
		throw new CorruptPresentationRecord();
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		Object.defineProperty(result, key, { value, enumerable: true });
	}
	return result;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new CorruptPresentationRecord();
	}
	return value;
}

function number(value: unknown, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
		throw new CorruptPresentationRecord();
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new CorruptPresentationRecord();
	}
	return value;
}

function text(value: unknown, max: number, nonempty = false): string {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		(nonempty && !value.trim()) ||
		new TextEncoder().encode(value).length > max ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value
	) {
		throw new CorruptPresentationRecord();
	}
	return value;
}

function choice<T extends string>(input: unknown, values: readonly T[]): T {
	const value = values.find((value) => value === input);
	if (!value) {
		throw new CorruptPresentationRecord();
	}
	return value;
}

function budget(input: unknown, max: number): void {
	const json = JSON.stringify(input);
	if (json === undefined || new TextEncoder().encode(json).length > max) {
		throw new CorruptPresentationRecord();
	}
}

function paneWidths(input: unknown): Record<string, string> {
	const value = object(input);
	if (Object.keys(value).length > WORKSPACE_PANES.length) {
		throw new CorruptPresentationRecord();
	}
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		choice(key, WORKSPACE_PANES);
		const width = text(entry, 16, true);
		if (!/^\d{1,4}(?:\.\d{1,2})?(?:px|%)$/.test(width)) {
			throw new CorruptPresentationRecord();
		}
		const amount = Number.parseFloat(width);
		if (amount <= 0 || (width.endsWith('%') ? amount > 100 : amount > 8192)) {
			throw new CorruptPresentationRecord();
		}
		result[key] = width;
	}
	return result;
}

function columnWidths(input: unknown): Record<string, number> {
	const value = object(input);
	const result: Record<string, number> = {};
	if (Object.keys(value).length > 3) {
		throw new CorruptPresentationRecord();
	}
	for (const [key, entry] of Object.entries(value)) {
		choice(key, ['name', 'permissions', 'modified']);
		result[key] = number(entry, 16, 8192);
	}
	return result;
}

function readStoredPresentationPreferences(input: unknown): StoredPresentationPreferences {
	const value = object(input, [
		'language',
		'frontendLogLevel',
		'timezone',
		'showPopupFileEditor',
		'shareFileEditorTabs',
		'showPopupFileManager',
		'dockerStatusIntervalSeconds',
		'dockerDefaultExpand',
		'statusMonitorScale',
		'dashboardShowLocalResources',
		'dashboardShowRemoteResources',
		'workspaceSidebarPersistent',
		'terminalScrollbackLimit',
		'showStatusMonitorIpAddress',
		'commandInputSyncTarget',
		'quickCommandsCollapsibleSearch',
		'quickCommandsCompactMode',
		'quickCommandRowSizeMultiplier',
		'terminalRightClickCopyPaste',
		'layoutLocked',
		'navBarVisible',
		'fileManagerShowDeleteConfirmation',
		'sidebarPaneWidths',
		'fileManagerRowSizeMultiplier',
		'fileManagerColWidths',
		'spreadsheetPreviewRowsPerPage',
		'spreadsheetPreviewMaxColumns',
		'rdpModalWidth',
		'rdpModalHeight',
		'vncModalWidth',
		'vncModalHeight',
		'showConnectionTags',
		'showQuickCommandTags',
	]);
	const timezone = text(value.timezone, 64, true);
	try {
		new Intl.DateTimeFormat('en', { timeZone: timezone });
	} catch {
		throw new CorruptPresentationRecord();
	}
	return {
		language: choice(value.language, PREFERENCE_LANGUAGES),
		frontendLogLevel: choice(value.frontendLogLevel, FRONTEND_LOG_LEVELS),
		timezone: timezone,
		showPopupFileEditor: boolean(value.showPopupFileEditor),
		shareFileEditorTabs: boolean(value.shareFileEditorTabs),
		showPopupFileManager: boolean(value.showPopupFileManager),
		dockerStatusIntervalSeconds: integer(value.dockerStatusIntervalSeconds, 1, 86400),
		dockerDefaultExpand: boolean(value.dockerDefaultExpand),
		statusMonitorScale: number(value.statusMonitorScale, 0.65, 1.6),
		dashboardShowLocalResources: boolean(value.dashboardShowLocalResources),
		dashboardShowRemoteResources: boolean(value.dashboardShowRemoteResources),
		workspaceSidebarPersistent: boolean(value.workspaceSidebarPersistent),
		terminalScrollbackLimit: integer(value.terminalScrollbackLimit, 0, 100000),
		showStatusMonitorIpAddress: boolean(value.showStatusMonitorIpAddress),
		commandInputSyncTarget: choice(value.commandInputSyncTarget, COMMAND_INPUT_SYNC_TARGETS),
		quickCommandsCollapsibleSearch: boolean(value.quickCommandsCollapsibleSearch),
		quickCommandsCompactMode: boolean(value.quickCommandsCompactMode),
		quickCommandRowSizeMultiplier: number(value.quickCommandRowSizeMultiplier, 0.5, 2.5),
		terminalRightClickCopyPaste: boolean(value.terminalRightClickCopyPaste),
		layoutLocked: boolean(value.layoutLocked),
		navBarVisible: boolean(value.navBarVisible),
		fileManagerShowDeleteConfirmation: boolean(value.fileManagerShowDeleteConfirmation),
		sidebarPaneWidths: paneWidths(value.sidebarPaneWidths),
		fileManagerRowSizeMultiplier: number(value.fileManagerRowSizeMultiplier, 0.5, 2),
		fileManagerColWidths: columnWidths(value.fileManagerColWidths),
		spreadsheetPreviewRowsPerPage: integer(value.spreadsheetPreviewRowsPerPage, 10, 2000),
		spreadsheetPreviewMaxColumns: integer(value.spreadsheetPreviewMaxColumns, 5, 200),
		rdpModalWidth: integer(value.rdpModalWidth, 320, 8192),
		rdpModalHeight: integer(value.rdpModalHeight, 200, 8192),
		vncModalWidth: integer(value.vncModalWidth, 320, 8192),
		vncModalHeight: integer(value.vncModalHeight, 200, 8192),
		showConnectionTags: boolean(value.showConnectionTags),
		showQuickCommandTags: boolean(value.showQuickCommandTags),
	};
}

function readStoredPresentationLayout(input: unknown): StoredPresentationLayout {
	let nodes = 0;
	const ids = new Set<string>();
	const panes = new Set<string>();

	function node(input: unknown, depth: number): StoredPresentationLayout {
		if (depth > PRESENTATION_LAYOUT_MAX_DEPTH || ++nodes > PRESENTATION_LAYOUT_MAX_NODES) {
			throw new CorruptPresentationRecord();
		}
		const raw = object(input);
		const id = text(raw.id, 64, true);
		if (ids.has(id)) {
			throw new CorruptPresentationRecord();
		}
		ids.add(id);
		const size = number(raw.size, 0, 100);
		if (raw.type === 'pane') {
			const value = object(input, ['type', 'id', 'size', 'component']);
			const component = choice(value.component, WORKSPACE_PANES);
			if (panes.has(component)) {
				throw new CorruptPresentationRecord();
			}
			panes.add(component);
			return { type: 'pane', id, size, component };
		}
		const value = object(input, ['type', 'id', 'size', 'direction', 'children']);
		if (
			value.type !== 'container' ||
			!Array.isArray(value.children) ||
			!value.children.length ||
			value.children.length > PRESENTATION_LAYOUT_MAX_NODES
		) {
			throw new CorruptPresentationRecord();
		}
		return {
			type: 'container',
			id,
			size,
			direction: choice(value.direction, ['horizontal', 'vertical']),
			children: value.children.map((child: unknown) => node(child, depth + 1)),
		};
	}

	return node(input, 0);
}

function readStoredPresentationFocus(input: unknown): StoredPresentationFocus {
	const value = object(input, ['sequence', 'shortcuts']);
	if (!Array.isArray(value.sequence) || value.sequence.length > 32) {
		throw new CorruptPresentationRecord();
	}
	const sequence = value.sequence.map((entry: unknown) => text(entry, 64, true));
	if (new Set(sequence).size !== sequence.length) {
		throw new CorruptPresentationRecord();
	}
	const raw = object(value.shortcuts);
	if (Object.keys(raw).length > 32) {
		throw new CorruptPresentationRecord();
	}
	const shortcuts: Record<string, string> = {};
	for (const [key, entry] of Object.entries(raw)) {
		if (!sequence.includes(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new CorruptPresentationRecord();
		}
		Object.defineProperty(shortcuts, key, { value: text(entry, 64, true), enumerable: true });
	}
	return { sequence, shortcuts };
}

function readStoredPresentationSidebar(input: unknown): StoredPresentationSidebar {
	const value = object(input, ['left', 'right']);
	if (
		!Array.isArray(value.left) ||
		!Array.isArray(value.right) ||
		value.left.length + value.right.length > WORKSPACE_PANES.length
	) {
		throw new CorruptPresentationRecord();
	}
	const left = value.left.map((entry: unknown) => choice(entry, WORKSPACE_PANES));
	const right = value.right.map((entry: unknown) => choice(entry, WORKSPACE_PANES));
	if (new Set([...left, ...right]).size !== left.length + right.length) {
		throw new CorruptPresentationRecord();
	}
	return { left, right };
}

function readStoredPresentationData(input: unknown): StoredPresentationData {
	budget(input, PRESENTATION_RESPONSE_MAX_BYTES);
	const value = object(input, ['preferences', 'layout', 'focus', 'sidebar']);
	return {
		preferences: readStoredPresentationPreferences(value.preferences),
		layout: readStoredPresentationLayout(value.layout),
		focus: readStoredPresentationFocus(value.focus),
		sidebar: readStoredPresentationSidebar(value.sidebar),
	};
}

export function presentationRow(row: SqlRow): StoredPresentationView {
	const version = integer(row.version, 1);
	const raw: unknown = JSON.parse(text(row.value_json, PRESENTATION_RESPONSE_MAX_BYTES));
	return { version, value: readStoredPresentationData(raw) };
}

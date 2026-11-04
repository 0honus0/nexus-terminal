export const PREFERENCE_LANGUAGES = ['en-US', 'zh-CN', 'ja-JP'] as const;

export type PreferenceLanguage = (typeof PREFERENCE_LANGUAGES)[number];

export const FRONTEND_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

export type FrontendLogLevel = (typeof FRONTEND_LOG_LEVELS)[number];

export const COMMAND_INPUT_SYNC_TARGETS = ['none', 'quickCommands', 'commandHistory'] as const;

export type CommandInputSyncTarget = (typeof COMMAND_INPUT_SYNC_TARGETS)[number];

export const WORKSPACE_PANES = [
	'connections',
	'terminal',
	'commandBar',
	'fileManager',
	'editor',
	'statusMonitor',
	'commandHistory',
	'quickCommands',
	'dockerManager',
	'suspendedSshSessions',
] as const;

export type WorkspacePane = (typeof WORKSPACE_PANES)[number];

export const PRESENTATION_REQUEST_MAX_BYTES = 128 * 1024;

export const DESKTOP_WINDOW_MIN_WIDTH = 320;

export const DESKTOP_WINDOW_MIN_HEIGHT = 200;

export const DESKTOP_WINDOW_MAX_DIMENSION = 8192;

export const PRESENTATION_RESPONSE_MAX_BYTES = 128 * 1024;

export const PRESENTATION_LAYOUT_MAX_DEPTH = 12;

export const PRESENTATION_LAYOUT_MAX_NODES = 100;

/** Numeric preference ranges consumed by editors, protocol and stored-record validation. */
export const PRESENTATION_PREFERENCE_BOUNDS = {
	terminalScrollbackLimit: { min: 0, max: 100_000 },
	dockerStatusIntervalSeconds: { min: 1, max: 86_400 },
	statusMonitorScale: { min: 0.65, max: 1.6 },
	quickCommandRowSizeMultiplier: { min: 0.5, max: 2.5 },
	fileManagerRowSizeMultiplier: { min: 0.5, max: 2 },
	spreadsheetPreviewRowsPerPage: { min: 10, max: 2000 },
	spreadsheetPreviewMaxColumns: { min: 5, max: 200 },
} as const;

export const PRESENTATION_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'version_conflict',
	'limit_exceeded',
	'storage_unavailable',
	'operation_unknown',
	'internal_failure',
	'unavailable',
] as const;

export type PresentationErrorCode = (typeof PRESENTATION_ERROR_CODES)[number];

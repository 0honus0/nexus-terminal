import type {
	WorkspaceFocusSnapshot,
	WorkspaceLayoutNodeState,
	WorkspaceLayoutConfiguration,
} from '../model/presentation-types';

export interface WorkspaceSettingsRepository {
	loadLayout(recover?: boolean): Promise<WorkspaceLayoutConfiguration>;
	saveResizedLayout(
		layout: WorkspaceLayoutNodeState,
		baseline: WorkspaceLayoutNodeState,
		permission?: AbortSignal,
	): Promise<void>;
	saveLayout(
		configuration: WorkspaceLayoutConfiguration,
		baseline: WorkspaceLayoutConfiguration,
		permission?: AbortSignal,
	): Promise<WorkspaceLayoutConfiguration>;
	loadFocus(recover?: boolean): Promise<WorkspaceFocusSnapshot>;
	saveFocus(snapshot: WorkspaceFocusSnapshot, permission?: AbortSignal): Promise<number>;
}

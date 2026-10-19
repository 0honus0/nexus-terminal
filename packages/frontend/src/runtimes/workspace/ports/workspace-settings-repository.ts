import type { WorkspaceLayoutSnapshot, WorkspaceFocusSnapshot } from '../model/presentation-types';

export interface WorkspaceSettingsRepository {
	loadLayout(recover?: boolean): Promise<WorkspaceLayoutSnapshot>;
	saveResizedLayout(snapshot: WorkspaceLayoutSnapshot, permission?: AbortSignal): Promise<number>;
	saveLayout(snapshot: WorkspaceLayoutSnapshot, permission?: AbortSignal): Promise<number>;
	loadFocus(recover?: boolean): Promise<WorkspaceFocusSnapshot>;
	saveFocus(snapshot: WorkspaceFocusSnapshot, permission?: AbortSignal): Promise<number>;
}

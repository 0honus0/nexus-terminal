import type { WorkspacePane } from '@nexus-terminal/shared/preferences/presentation/values';

/** Editor drafts may contain incomplete containers until the user saves. */
export interface WorkspaceLayoutNodeState {
	id: string;
	type: 'pane' | 'container';
	size?: number;
	component?: WorkspacePane;
	direction?: 'horizontal' | 'vertical';
	children?: WorkspaceLayoutNodeState[];
}

export interface WorkspaceSidebar {
	left: WorkspacePane[];
	right: WorkspacePane[];
}

export interface WorkspaceFocusConfig {
	sequence: string[];
	shortcuts: Record<string, string>;
}

export interface WorkspaceLayoutSnapshot {
	version: number;
	layout: WorkspaceLayoutNodeState;
	sidebar: WorkspaceSidebar;
}

export interface WorkspaceFocusSnapshot {
	version: number;
	focus: WorkspaceFocusConfig;
}

import { inject, provide, type InjectionKey } from 'vue';
import { createWorkspaceLayoutController, type WorkspaceLayoutController } from '../layout/workspaceLayout';
import { createWorkspaceFocusController, type WorkspaceFocusController } from '../focus/workspaceFocus';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { workspaceSettingsAdapter } from '../adapters/workspace-settings-adapter';

export interface WorkspaceUiState {
	layout: WorkspaceLayoutController;
	focus: WorkspaceFocusController;
}

const workspaceUiStateKey: InjectionKey<WorkspaceUiState> = Symbol('workspace-ui-state');

export const provideWorkspaceUiState = (): WorkspaceUiState => {
	const scope = useAuthenticatedViewScope({
		onRevoke: () => {
			state.layout.resetState();
			state.focus.resetState();
		},
	});
	const state = {
		layout: createWorkspaceLayoutController(workspaceSettingsAdapter, scope.capture),
		focus: createWorkspaceFocusController(workspaceSettingsAdapter, scope.capture),
	};
	provide(workspaceUiStateKey, state);
	return state;
};

export const useWorkspaceUiState = (): WorkspaceUiState => {
	const state = inject(workspaceUiStateKey);
	if (!state) throw new Error('Workspace UI state provider is unavailable.');
	return state;
};

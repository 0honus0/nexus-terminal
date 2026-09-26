import { inject, provide, type InjectionKey } from 'vue';
import { createWorkspaceLayoutController, type WorkspaceLayoutController } from '../layout/workspaceLayout';
import { createWorkspaceFocusController, type WorkspaceFocusController } from '../focus/workspaceFocus';
import { workspaceSettingsHttpRepository } from '../adapters/workspaceSettingsHttpRepository';

export interface WorkspaceUiState {
  layout: WorkspaceLayoutController;
  focus: WorkspaceFocusController;
}

const workspaceUiStateKey: InjectionKey<WorkspaceUiState> = Symbol('workspace-ui-state');

export const provideWorkspaceUiState = (): WorkspaceUiState => {
  const state = {
    layout: createWorkspaceLayoutController(workspaceSettingsHttpRepository),
    focus: createWorkspaceFocusController(workspaceSettingsHttpRepository),
  };
  provide(workspaceUiStateKey, state);
  return state;
};

export const useWorkspaceUiState = (): WorkspaceUiState => {
  const state = inject(workspaceUiStateKey);
  if (!state) throw new Error('Workspace UI state provider is unavailable.');
  return state;
};

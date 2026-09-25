export const loadWorkspaceView = () => import('./views/WorkspaceView.vue');

export const disposeWorkspaceRuntimes = async (reason = 'Workspace runtime disposed'): Promise<void> => {
  const { workspaceRuntimeRegistry } = await import('./session');
  workspaceRuntimeRegistry.disposeAll(reason);
};

export type {
  WorkspaceLayoutNodeState,
  WorkspacePaneNameDto,
  WorkspaceSidebarConfigDto,
} from './layout/workspaceLayout';

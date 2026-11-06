export { default as WorkspaceStartPage } from '../components/WorkspaceStartPage.vue';

export { default as WorkspaceTabBar } from '../components/WorkspaceTabBar.vue';

export { provideWorkspaceUiState } from '../state/workspaceUiState';

export { workspaceRuntimeRegistry, type WorkspaceRuntimeSession } from '../session';

export { workspaceConnectionFailureCode } from '../model/workspace-error-types';

export { loadWorkspaceSessionSurface } from '../components/preloadWorkspaceTerminalSurface';

export const loadWorkspaceLayoutConfigurator = () => import('../components/WorkspaceLayoutConfigurator.vue');

export const loadWorkspaceFocusConfigurator = () => import('../components/WorkspaceFocusConfigurator.vue');

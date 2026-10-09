import { loadTerminalView } from '@/features/terminal/public';

export const loadWorkspaceSessionSurface = () => import('./WorkspaceSessionSurface.vue');

export const preloadWorkspaceTerminalSurface = (): void => {
	void Promise.allSettled([loadWorkspaceSessionSurface(), loadTerminalView()]);
};

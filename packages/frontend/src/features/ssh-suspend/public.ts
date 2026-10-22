export const loadSuspendedSessionsPanel = () => import('./components/SuspendedSessionsPanel.vue');

export const loadSuspendedSessionsModal = () => import('./components/SuspendedSessionsModal.vue');

export {
	useSuspendedSessions,
	startSuspendedSessionsSync,
	applySuspendedAutoTermination,
	refreshSuspendedSessionsCatalog,
	resetSuspendedSessionsCatalog,
	refreshSuspendedSessionsAfterHandoff,
	removeSuspendedSessionFromCatalog,
	findSuspendedSessionByOriginalWorkspace,
	findSuspendedSessionById,
} from './composables/useSuspendedSessions';

export type {
	SuspendedSessionsController,
	SuspendedSessionsLoadOptions,
	SuspendedSessionsLoadResult,
} from './model/suspended-session-types';

export type { SuspendedAutoTermination } from './model/suspended-session-types';

export { toSuspendedAutoTermination } from './model/suspended-session-mapper';

export type { SshSuspendChannel } from './ports/ssh-suspend-channel';

export type { MarkedSuspendedSessionState, SuspendedSession } from './model/suspended-session-types';

export type { SuspendedAutoTerminationViewModel } from './model/suspended-session-types';

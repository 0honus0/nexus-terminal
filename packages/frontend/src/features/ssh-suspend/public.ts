export const loadSuspendedSessionsPanel = () => import('./components/SuspendedSessionsPanel.vue');
export const loadSuspendedSessionsModal = () => import('./components/SuspendedSessionsModal.vue');
export {
  useSuspendedSessions,
  applySuspendedAutoTermination,
  refreshSuspendedSessionsCatalog,
  resetSuspendedSessionsCatalog,
  refreshSuspendedSessionsAfterHandoff,
  removeSuspendedSessionFromCatalog,
  findSuspendedSessionByOriginalWorkspace,
} from './composables/useSuspendedSessions';
export type {
  SuspendedSessionsController,
  SuspendedSessionsLoadOptions,
  SuspendedSessionsLoadResult,
} from './composables/useSuspendedSessions';
export type {
  WorkspaceSuspendAutoTerminatedEventDto,
  SuspendedAutoTerminationViewModel,
} from './composables/useSuspendedSessions';
export type { SshSuspendChannel } from './ports/ssh-suspend-channel';
export type {
  MarkedSuspendedSessionState,
  WorkspaceSuspendResumeRequestDto,
  SuspendedSessionDto,
  SuspendedSessionStatusDto,
} from './model/sshSuspend';

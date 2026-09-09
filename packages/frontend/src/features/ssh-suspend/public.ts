export const loadSuspendedSessionsPanel = () => import('./components/SuspendedSessionsPanel.vue');
export const loadSuspendedSessionsModal = () => import('./components/SuspendedSessionsModal.vue');
export {
  useSuspendedSessions,
  applySuspendedAutoTermination,
  refreshSuspendedSessionsCatalog,
  refreshSuspendedSessionsAfterHandoff,
  removeSuspendedSessionFromCatalog,
  findSuspendedSessionByOriginalWorkspace,
} from './composables/useSuspendedSessions';
export type { SuspendedAutoTerminationEvent, SuspendedAutoTerminationNotice } from './composables/useSuspendedSessions';
export type { SshSuspendChannel } from './ports/ssh-suspend-channel';
export type {
  MarkedSuspendedSession,
  ResumeSuspendedSessionRequest,
  SuspendedSession,
  SuspendedSessionStatus,
} from './model/sshSuspend';

export const loadConnectionEditorModal = () => import('./components/ConnectionEditorModal.vue');
export { markConnectionConnected, refreshConnection, useConnections } from './composables/useConnections';
export { connectionsApi as connectionService } from './api/connectionsApi';
export type {
  Connection,
  ConnectionAuthMethod,
  ConnectionInput,
  ConnectionRoute,
  ConnectionTestResult,
  ConnectionType,
  ConnectionUpdate,
  RdpOptions,
} from './model/connection';

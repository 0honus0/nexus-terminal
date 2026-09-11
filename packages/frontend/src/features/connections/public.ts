export { default as ConnectionsView } from './views/ConnectionsView.vue';
export { default as ConnectionEditorModal } from './components/ConnectionEditorModal.vue';
export { refreshConnection, useConnections } from './composables/useConnections';
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

export const loadConnectionsView = () => import('./views/ConnectionsView.vue');
export const loadConnectionEditorModal = () => import('./components/ConnectionEditorModal.vue');
export {
  markConnectionConnected,
  refreshConnection,
  resetConnectionsCache,
  useConnections,
} from './composables/useConnections';
export type { ConnectionsController } from './composables/useConnections';
export { connectionsApi as connectionService } from './api/connectionsApi';
export type {
  ConnectionDto,
  ConnectionAuthMethodDto,
  ConnectionFormInput,
  ConnectionRouteDto,
  ConnectionTestResponseDto,
  ConnectionTypeDto,
  ConnectionFormUpdate,
  RdpConnectionOptionsDto,
} from './model/connection';

export const loadConnectionsView = () => import('./views/ConnectionsView.vue');

export const loadConnectionEditorModal = () => import('./components/ConnectionEditorModal.vue');

export {
	markConnectionConnected,
	refreshConnection,
	resetConnectionsCache,
	useConnections,
} from './composables/useConnections';

export type { ConnectionSummary, ConnectionsController } from './model/connection-types';

export { useConnectionManagement } from './composables/use-connection-management';

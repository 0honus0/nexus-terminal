// Test-only entry: bundle the real clients without exposing test hooks in the product build.
export { requestNativeWorkspace } from '../../../packages/frontend/src/features/agent/api/native-workspace-request';

export { AgentManagementFailure } from '../../../packages/frontend/src/features/agent/model/management-failure';

export { attachDesktopTouch } from '../../../packages/frontend/src/features/remote-desktop/adapters/desktop-touch';

export { createAgentWindowManager } from '../../../packages/frontend/src/features/agent/host/window-manager';

export { serverTransfersApi } from '../../../packages/frontend/src/features/transfers/api/server-transfers-api';

export { connectionsApi } from '../../../packages/frontend/src/features/connections/api/connections-api';

export { rememberServerTransferDirectory } from '../../../packages/frontend/src/features/transfers/model/server-transfer-directory';

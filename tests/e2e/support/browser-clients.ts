// Test-only entry: bundle the real clients without exposing test hooks in the product build.
export { listNativeEvents } from '../../../packages/frontend/src/features/agent/api/native-run-api';

export { AgentManagementFailure } from '../../../packages/frontend/src/features/agent/model/management-failure';

export { attachDesktopTouch } from '../../../packages/frontend/src/features/remote-desktop/adapters/desktop-touch';

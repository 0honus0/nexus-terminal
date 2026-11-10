// Test-only entry: bundle the real clients without exposing test hooks in the product build.
export { attachDesktopTouch } from '../../../packages/frontend/src/features/remote-desktop/adapters/desktop-touch';

export { serverTransfersApi } from '../../../packages/frontend/src/features/transfers/api/server-transfers-api';

export { connectionsApi } from '../../../packages/frontend/src/features/connections/api/connections-api';

export { rememberServerTransferDirectory } from '../../../packages/frontend/src/features/transfers/model/server-transfer-directory';

export { appearanceApi } from '../../../packages/frontend/src/features/appearance/api/appearance-api';

export { themeApi } from '../../../packages/frontend/src/features/appearance/api/theme-api';

export { createAccessApi } from '../../../packages/frontend/src/features/auth/api/access-api';

export { createPasskeyCeremony } from '../../../packages/frontend/src/features/auth/adapters/browser-passkey';

export { useAuthStore } from '../../../packages/frontend/src/features/auth/store/auth.store';

export { createPinia } from 'pinia';

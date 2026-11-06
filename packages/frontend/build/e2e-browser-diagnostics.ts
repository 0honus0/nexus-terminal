// Test-only entry; production builds do not expose diagnostics hooks.
export { createApp } from 'vue';

export { logger, setFrontendLogLevel } from '../src/client/logging/logger';

export { requestJson } from '../src/client/http/json-client';

export { httpClient } from '../src/client/http/httpClient';

export {
	registerGlobalRuntimeDiagnostics,
	registerVueRuntimeDiagnostics,
} from '../src/app/bootstrap/runtimeDiagnostics';

export { openWebSocket } from '../src/client/websocket/webSocketTransport';

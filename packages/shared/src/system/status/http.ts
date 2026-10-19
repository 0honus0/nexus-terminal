import type { SystemStatusErrorCode, SYSTEM_HEALTH_STATUS, SYSTEM_SERVICE_NAME } from './values.js';
import type { LocalSystemStatus } from './model.js';

export type LocalSystemStatusResponse = LocalSystemStatus;

export interface LocalSystemStatusError {
	code: SystemStatusErrorCode;
}

export interface SystemHealthResponse {
	status: typeof SYSTEM_HEALTH_STATUS;
	service: typeof SYSTEM_SERVICE_NAME;
}

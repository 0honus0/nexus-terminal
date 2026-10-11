import type { SystemStatusErrorCode } from './values.js';
import type { LocalSystemStatus } from './model.js';

export type LocalSystemStatusResponse = LocalSystemStatus;

export interface LocalSystemStatusError {
	code: SystemStatusErrorCode;
}

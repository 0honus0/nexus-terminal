import type { BackendLogLevel } from './values.js';
import type { BackendLoggingView } from './model.js';

export interface BackendLoggingUpdate {
	expectedVersion: number;
	level: BackendLogLevel;
}

export interface BackendLoggingResponse {
	logging: BackendLoggingView;
}

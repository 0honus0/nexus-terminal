import type { BackendLogLevel } from './values.js';

export interface BackendLoggingView {
	version: number;
	level: BackendLogLevel;
	effectiveLevel: BackendLogLevel;
	updatedAt: number;
}

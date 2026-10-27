import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';

export interface BackendLogging {
	version: number;
	level: BackendLogLevel;
	effectiveLevel: BackendLogLevel;
	updatedAt: number;
}

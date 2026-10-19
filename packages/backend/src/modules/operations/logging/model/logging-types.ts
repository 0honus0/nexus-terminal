import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';

export interface LoggingState {
	version: number;
	level: BackendLogLevel;
	updatedAt: number;
}

export interface LoggingActor {
	userId: number;
	token: string;
}

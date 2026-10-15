import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';

export interface StoredLogging {
	version: number;
	level: BackendLogLevel;
	updatedAt: number;
}

export interface LoggingStorage {
	get(): Promise<StoredLogging | null>;
	update(
		version: number,
		level: BackendLogLevel,
		now: number,
		admit: (userId: number | null) => void,
		digest: string,
	): Promise<StoredLogging>;
}

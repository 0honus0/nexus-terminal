export type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

export type LogThreshold = LogSeverity | 'silent';

export interface LogFact {
	name: string;
	value: string | number | boolean | null;
}

export interface Logger {
	isEnabled(severity: LogSeverity): boolean;
	setThreshold(level: LogThreshold): void;
	write(severity: LogSeverity, code: string, facts: readonly LogFact[]): void;
}

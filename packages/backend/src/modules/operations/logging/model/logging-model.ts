import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { Logger } from '../../../../platform/logging/logger.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
import type { LoggingStorage } from '../storage/logging-storage.js';
import type { LoggingState, LoggingActor } from './logging-types.js';
import { operationsStorage } from '../../operations-storage-failure.js';

export class LoggingModel {
	constructor(
		private readonly storage: LoggingStorage,
		private readonly tokens: SessionTokens,
		private readonly logger: Logger,
	) {}

	async get(): Promise<LoggingState | null> {
		const value = await operationsStorage(() => this.storage.get());
		return value ? { version: value.version, level: value.level, updatedAt: value.updatedAt } : null;
	}

	async update(
		actor: LoggingActor,
		version: number,
		level: BackendLogLevel,
		admit: (userId: number | null) => void,
	): Promise<LoggingState> {
		const value = await operationsStorage(() =>
			this.storage.update(version, level, (userId) => admit(userId), this.tokens.digest(actor.token)),
		);
		return { version: value.version, level: value.level, updatedAt: value.updatedAt };
	}

	activate(level: BackendLogLevel): void {
		logDiagnostic(this.logger, 'info', 'LOG_LEVEL_ACTIVATING', { level });
		this.logger.setThreshold(level);
		logDiagnostic(this.logger, 'info', 'LOG_LEVEL_ACTIVATED', { level });
	}

	record(event: OperationEvent, id: number, severity: 'info' | 'warn'): void {
		this.logger.write(severity, event, [{ name: 'auditId', value: id }]);
	}
}

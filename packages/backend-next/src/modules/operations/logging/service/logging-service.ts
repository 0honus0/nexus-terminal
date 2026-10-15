import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
import { BACKEND_LOG_LEVELS } from '@nexus-terminal/shared/operations/logging/values';
import type { LoggingModel } from '../model/logging-model.js';
import type { LoggingActor, LoggingState } from '../model/logging-types.js';
import { OperationsFailure } from '../../operations-failure.js';

export class LoggingService {
	private active: BackendLogLevel = 'info';
	private activeVersion = -1;

	private activate(state: LoggingState): void {
		if (state.version < this.activeVersion) {
			return;
		}
		this.model.activate(state.level);
		this.active = state.level;
		this.activeVersion = state.version;
	}

	constructor(private readonly model: LoggingModel) {}

	async initialize(): Promise<void> {
		const state = await this.get();
		this.activate(state);
	}

	async get(): Promise<LoggingState> {
		return (await this.model.get()) ?? { version: 0, level: 'info', updatedAt: 0 };
	}

	effective(): BackendLogLevel {
		return this.active;
	}

	async update(actor: LoggingActor, version: number, level: BackendLogLevel): Promise<LoggingState> {
		if (actor.userId !== 1 || !actor.token) {
			throw new OperationsFailure('forbidden');
		}
		if (!Number.isSafeInteger(version) || version < 0 || !BACKEND_LOG_LEVELS.includes(level)) {
			throw new OperationsFailure('invalid_input');
		}
		const saved = await this.model.update(actor, version, level, Date.now(), (id) => {
			if (id === null) {
				throw new OperationsFailure('unauthenticated');
			}
			if (id !== actor.userId) {
				throw new OperationsFailure('forbidden');
			}
		});
		try {
			const current = await this.get();
			this.activate(current);
			return saved;
		} catch (error) {
			throw new OperationsFailure('operation_unknown', { cause: error });
		}
	}

	record(event: OperationEvent, id: number): void {
		this.model.record(
			event,
			id,
			/(?:FAILURE|FAILED|UNKNOWN|UNAUTHORIZED|BLOCKED|ATTENTION_REQUIRED)$/u.test(event) ? 'warn' : 'info',
		);
	}
}

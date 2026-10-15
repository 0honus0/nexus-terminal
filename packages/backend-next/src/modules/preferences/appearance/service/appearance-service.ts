import { AppearanceFailure } from '../../appearance-failure.js';
import type { AppearanceModel } from '../model/appearance-model.js';
import type {
	AppearanceActor,
	AppearanceRecord,
	AppearanceChange,
	AppearanceAccessResult,
} from '../model/appearance-types.js';
import { defaultAppearance, admitAppearanceChange } from '../appearance-rules.js';

export class AppearanceService {
	private accepting = true;
	private readonly inputs = new Set<AbortController>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly failures: unknown[] = [];
	private droppedFailures = 0;
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: AppearanceModel) {}

	private run<T>(actor: AppearanceActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new AppearanceFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new AppearanceFailure('unauthenticated'));
		}
		const task = Promise.resolve().then(() => {
			if (!this.accepting) {
				throw new AppearanceFailure('unavailable');
			}
			return work();
		});
		this.pending.add(task);
		void task
			.catch((error) => {
				if (
					!(error instanceof AppearanceFailure) ||
					['storage_unavailable', 'operation_unknown', 'internal_failure'].includes(error.code)
				) {
					if (this.failures.length < 32) {
						this.failures.push(error);
					} else {
						this.droppedFailures++;
					}
				}
			})
			.finally(() => this.pending.delete(task));
		return task;
	}

	private admit(actor: AppearanceActor, userId: number | null): void {
		if (userId === null) {
			throw new AppearanceFailure('unauthenticated');
		}
		if (userId !== actor.userId) {
			throw new AppearanceFailure('forbidden');
		}
		if (!this.accepting) {
			throw new AppearanceFailure('unavailable');
		}
	}

	get(actor: AppearanceActor): Promise<AppearanceAccessResult> {
		return this.run(actor, () =>
			this.model.access(
				actor,
				null,
				'default',
				(userId) => this.admit(actor, userId),
				(facts) => (facts.current === null ? defaultAppearance(facts.defaultThemeId) : null),
			),
		);
	}

	update(
		actor: AppearanceActor,
		loadInput: (signal: AbortSignal) => Promise<AppearanceChange>,
	): Promise<AppearanceRecord> {
		return this.run(actor, async () => {
			const controller = new AbortController();
			this.inputs.add(controller);
			let change: AppearanceChange;
			try {
				change = await loadInput(controller.signal);
			} finally {
				this.inputs.delete(controller);
			}
			if (!this.accepting) {
				throw new AppearanceFailure('unavailable');
			}
			if (
				!Number.isSafeInteger(change.expectedVersion) ||
				change.expectedVersion < 1 ||
				change.expectedVersion >= Number.MAX_SAFE_INTEGER
			) {
				throw new AppearanceFailure('invalid_input');
			}
			const result = await this.model.access(
				actor,
				change.patch.activeTerminalThemeId ?? null,
				'default',
				(userId) => this.admit(actor, userId),
				(facts) => admitAppearanceChange(facts, change),
			);
			return result.value;
		});
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.inputs) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([...this.pending]);
				if (this.failures.length || this.droppedFailures) {
					throw new AggregateError(
						this.failures,
						'Appearance shutdown failures; additional=' + this.droppedFailures,
					);
				}
			});
		}
		return this.closePromise;
	}
}

import { FailureSummary } from '../../platform/lifecycle/failure-summary.js';
import { PreferencesFailure } from './preferences-failure.js';
import { PresentationFailure } from './presentation-failure.js';
import { HistoryFailure } from './history-failure.js';
import { FavoriteFailure } from './favorite-failure.js';
import { CommandFailure } from './command-failure.js';

function isDrainFailure(error: unknown): boolean {
	if (
		!(error instanceof PreferencesFailure) &&
		!(error instanceof PresentationFailure) &&
		!(error instanceof HistoryFailure) &&
		!(error instanceof FavoriteFailure) &&
		!(error instanceof CommandFailure)
	) {
		return true;
	}
	return (
		error.code === 'storage_unavailable' ||
		error.code === 'operation_unknown' ||
		error.code === 'internal_failure' ||
		error.code === 'unavailable'
	);
}

/** Observe admitted requests until settled and retain bounded real failures for shutdown. */
export class PreferencesTasks {
	private readonly pending = new Set<Promise<void>>();
	private readonly failures = new FailureSummary();

	get size(): number {
		return this.pending.size;
	}

	run<T>(work: () => Promise<T>): Promise<T> {
		const task = Promise.resolve().then(work);
		const observed = task
			.then(
				() => undefined,
				(cause: unknown) => {
					if (isDrainFailure(cause)) {
						this.failures.record(cause);
					}
				},
			)
			.finally(() => this.pending.delete(observed));
		this.pending.add(observed);
		return task;
	}

	async drain(): Promise<void> {
		await Promise.all(this.pending);
		const failures = this.failures.errors();
		if (failures.length) {
			throw new AggregateError(failures, 'Preferences requests failed during shutdown');
		}
	}
}

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

/** Drain admitted requests without turning expected use-case refusals into shutdown failures. */
export async function drainPreferences(pending: readonly Promise<unknown>[]): Promise<void> {
	const results = await Promise.allSettled(pending);
	const failures = results.flatMap((result) =>
		result.status === 'rejected' && isDrainFailure(result.reason) ? [result.reason] : [],
	);
	if (failures.length) {
		throw new AggregateError(failures, 'Preferences requests failed during shutdown');
	}
}

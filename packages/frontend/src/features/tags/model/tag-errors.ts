import { TargetRequestFailure } from '@/client/targets/target-types';

/** Earlier confirmed creations remain stored even when a later name is refused. */
export class TagEnsureFailure extends TargetRequestFailure {
	constructor(
		readonly completed: number,
		cause: unknown,
	) {
		super(
			cause instanceof TargetRequestFailure ? cause.code : 'request_failed',
			cause instanceof TargetRequestFailure && cause.outcome !== 'unknown' ? 'confirmed' : 'unknown',
			{ cause },
		);
		this.name = 'TagEnsureFailure';
	}
}

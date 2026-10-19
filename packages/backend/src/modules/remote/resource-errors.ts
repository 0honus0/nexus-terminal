/** Internal evidence that remote resource cleanup failed, independent of the operation outcome. */
export class RemoteResourceCleanupFailure extends AggregateError {
	constructor(errors: readonly unknown[]) {
		super(errors, 'Remote resource cleanup failed');
		this.name = 'RemoteResourceCleanupFailure';
	}
}

/** Technical cleanup failure retains all causes for the application's resource owner. */
export class TerminalCleanupFailure extends Error {
	constructor(causes: readonly unknown[]) {
		super('Terminal resource cleanup failed', {
			cause: new AggregateError(causes, 'Terminal operation and cleanup failed'),
		});
		this.name = 'TerminalCleanupFailure';
	}
}

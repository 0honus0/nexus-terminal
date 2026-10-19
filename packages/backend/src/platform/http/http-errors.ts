export class HttpInputFailure extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

export class HttpLifecycleFailure extends Error {
	constructor(
		readonly kind: 'invalid_state' | 'invalid_owner' | 'drain_failed',
		options?: ErrorOptions,
	) {
		super('HTTP lifecycle failed: ' + kind, options);
		this.name = 'HttpLifecycleFailure';
	}
}

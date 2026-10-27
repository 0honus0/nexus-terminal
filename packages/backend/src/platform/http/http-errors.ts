export class HttpInputFailure extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		options?: ErrorOptions,
	) {
		super(code, options);
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

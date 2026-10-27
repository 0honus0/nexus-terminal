import type { ConnectionTestErrorCode } from '@nexus-terminal/shared/targets/connections/values';

export class ConnectionTestFailure extends Error {
	constructor(
		readonly code: ConnectionTestErrorCode,
		options?: ErrorOptions,
	) {
		super('SSH connection test failed: ' + code, options);
		this.name = 'ConnectionTestFailure';
	}
}

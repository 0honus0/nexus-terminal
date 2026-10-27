import type { ConnectionTestErrorCode } from '@nexus-terminal/shared/targets/connections/values';
import type { HttpRequestFailureCode } from '@/client/http/request-failure';

export class ConnectionTestFailure extends Error {
	constructor(
		readonly code: ConnectionTestErrorCode | HttpRequestFailureCode,
		options?: ErrorOptions,
	) {
		super('Connection test failed', options);
		this.name = 'ConnectionTestFailure';
	}
}

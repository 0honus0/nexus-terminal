import type { ConnectionTestErrorCode } from '@nexus-terminal/shared/targets/connections/values';
import type { HttpRequestFailureCode } from '@/client/http/request-failure';
import type { HostKeyTrustRequest } from './host-key-types';

export class ConnectionTestFailure extends Error {
	constructor(
		readonly code: ConnectionTestErrorCode | HttpRequestFailureCode,
		options?: ErrorOptions,
	) {
		super('Connection test failed', options);
		this.name = 'ConnectionTestFailure';
	}
}

export class ConnectionTestHostKeyFailure extends ConnectionTestFailure {
	constructor(readonly hostKey: HostKeyTrustRequest) {
		super('host_key_untrusted');
		this.name = 'ConnectionTestHostKeyFailure';
	}
}

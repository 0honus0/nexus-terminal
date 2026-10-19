import type { AccessHttpErrorCode } from '@nexus-terminal/shared/access/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';

export type AuthRequestFailureCode = AccessHttpErrorCode | HttpRequestFailureCode;

export class AuthRequestFailure extends Error {
	constructor(
		readonly code: AuthRequestFailureCode,
		readonly outcome: RequestOutcome,
		readonly status: number | null = null,
		options?: ErrorOptions,
	) {
		super('Authentication request failed', options);
		this.name = 'AuthRequestFailure';
	}
}

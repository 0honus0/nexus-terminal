import type { TargetHttpErrorCode } from '@nexus-terminal/shared/targets/values';
import { InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import type { HttpRequestFailureCode, RequestOutcome } from '../http/request-failure';

export type TargetRequestFailureCode =
	TargetHttpErrorCode | HttpRequestFailureCode | 'recovery_required' | 'request_pending';

export class TargetRequestFailure extends Error {
	constructor(
		readonly code: TargetRequestFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Target request failed', options);
		this.name = 'TargetRequestFailure';
	}
}

export function targetErrorKey(cause: unknown, operation: 'read' | 'write' = 'write'): string {
	if (cause instanceof InvalidTargetPayload) {
		return 'invalid_input';
	}
	if (!(cause instanceof TargetRequestFailure)) {
		return 'failed';
	}
	if (cause.outcome === 'unknown' && operation === 'write') {
		return 'unknown';
	}
	switch (cause.code) {
		case 'unauthenticated':
		case 'forbidden':
		case 'version_conflict':
		case 'not_found':
		case 'reference_in_use':
		case 'invalid_input':
		case 'recovery_required':
		case 'request_pending':
		case 'limit_exceeded':
			return cause.code;
		default:
			return 'failed';
	}
}

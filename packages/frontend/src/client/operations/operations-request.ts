import { readOperationsError } from '@nexus-terminal/shared/operations/http-codec';
import {
	OPERATIONS_BODY_MAX_BYTES,
	OPERATIONS_RESPONSE_MAX_BYTES,
	type OperationsErrorCode,
} from '@nexus-terminal/shared/operations/values';
import { requestJson, type JsonRequest } from '../http/json-client';
import { HttpRequestFailure, type RequestOutcome } from '../http/request-failure';

type FailureCode = OperationsErrorCode | HttpRequestFailure['code'] | 'refresh_required';

export class OperationsRequestFailure extends Error {
	constructor(
		readonly code: FailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Operations request failed', options);
		this.name = 'OperationsRequestFailure';
	}
}

const failureStatus: Record<OperationsErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	delivery_failed: 502,
	delivery_unknown: 503,
	internal_failure: 503,
	shutting_down: 503,
};

export async function requestOperation<T>(input: {
	path: string;
	method: JsonRequest['method'];
	decode(value: unknown): T;
	input?: () => unknown;
	signal?: AbortSignal;
}): Promise<T> {
	let body: unknown;
	try {
		body = input.input?.();
	} catch (cause) {
		throw new OperationsRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	let result;
	try {
		result = await requestJson({
			method: input.method,
			url: '/api/v1' + input.path,
			body,
			maxRequestBytes: OPERATIONS_BODY_MAX_BYTES,
			maxResponseBytes: OPERATIONS_RESPONSE_MAX_BYTES,
			signal: input.signal,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new OperationsRequestFailure(cause.code, cause.outcome, { cause });
		}
		throw new OperationsRequestFailure('request_failed', 'unknown', { cause });
	}
	if (result.status >= 400) {
		let code: OperationsErrorCode;
		try {
			code = readOperationsError(result.body).code;
			if (failureStatus[code] !== result.status) {
				throw new Error('Inconsistent operations status');
			}
		} catch (cause) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown', { cause });
		}
		const unknown = ['operation_unknown', 'delivery_unknown', 'storage_unavailable', 'internal_failure'].includes(
			code,
		);
		throw new OperationsRequestFailure(code, unknown ? 'unknown' : 'confirmed');
	}
	try {
		if (result.status !== 200) {
			throw new Error('Unexpected operations status');
		}
		return input.decode(result.body);
	} catch (cause) {
		throw new OperationsRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

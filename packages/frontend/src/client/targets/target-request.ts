import {
	readTargetError,
	targetHttpBodyLimit,
	targetManagementResponseLimit,
} from '@nexus-terminal/shared/targets/http';
import type { TargetHttpErrorCode } from '@nexus-terminal/shared/targets/values';
import { requestJson } from '../http/json-client';
import { HttpRequestFailure } from '../http/request-failure';
import { dispatchUnauthorized } from '../http/unauthorized';
import { TargetRequestFailure } from './target-types';

interface TargetRequest<T> {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	path: string;
	status: number;
	decode(value: unknown): T;
	input?: () => unknown;
	signal?: AbortSignal;
}

function errorStatus(code: TargetHttpErrorCode): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'invalid_input':
			return 400;
		case 'not_found':
		case 'reference_not_found':
			return 404;
		case 'reference_in_use':
		case 'conflict':
		case 'version_conflict':
			return 409;
		case 'unresolvable':
			return 422;
		case 'body_too_large':
		case 'limit_exceeded':
			return 413;
		case 'request_timeout':
			return 408;
		case 'storage_unavailable':
		case 'operation_unknown':
			return 503;
		case 'internal_failure':
			return 500;
	}
}

/** Targets resource transport; the same Access HttpOnly session is sent by the JSON client. */
export async function requestTarget<T>(input: TargetRequest<T>): Promise<T> {
	let body: unknown;
	let maxRequestBytes: number;
	let maxResponseBytes: number;
	try {
		body = input.input?.();
		maxRequestBytes = targetHttpBodyLimit(input.path);
		maxResponseBytes = targetManagementResponseLimit(input.path);
	} catch (cause) {
		throw new TargetRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method: input.method,
			url: '/api/v1/targets' + input.path,
			body,
			signal: input.signal,
			maxRequestBytes,
			maxResponseBytes,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new TargetRequestFailure(cause.code, cause.outcome, { cause });
		}
		throw new TargetRequestFailure('request_failed', 'unknown', { cause });
	}
	if (response.status >= 400) {
		let code;
		try {
			code = readTargetError(response.body).code;
			if (errorStatus(code) !== response.status) {
				throw new Error('Inconsistent Target failure');
			}
		} catch (cause) {
			throw new TargetRequestFailure('protocol_failure', 'unknown', { cause });
		}
		const unknown = code === 'operation_unknown' || code === 'internal_failure' || code === 'storage_unavailable';
		if (code === 'unauthenticated') dispatchUnauthorized('/targets' + input.path);
		throw new TargetRequestFailure(code, unknown ? 'unknown' : 'confirmed');
	}
	try {
		if (response.status !== input.status) {
			throw new Error('Unexpected Target status');
		}
		return input.decode(response.body);
	} catch (cause) {
		throw new TargetRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

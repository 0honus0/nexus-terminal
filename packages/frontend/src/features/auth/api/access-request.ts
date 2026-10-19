import { readAccessHttpError } from '@nexus-terminal/shared/access/http';
import {
	ACCESS_AUTH_REQUEST_MAX_BYTES,
	ACCESS_AUTH_RESPONSE_MAX_BYTES,
	type AccessHttpErrorCode,
} from '@nexus-terminal/shared/access/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { AuthRequestFailure } from '../model/auth-failure';

interface AccessRequest<T> {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	path: string;
	status: number;
	decode(value: unknown): T;
	input?: () => unknown;
	signal?: AbortSignal;
	maxRequestBytes?: number;
	maxResponseBytes?: number;
	refused?: (status: number, value: unknown) => AccessHttpErrorCode | null;
}

export type SendAccessRequest = <T>(input: AccessRequest<T>) => Promise<T>;

export function createAccessRequest(basePath: string): SendAccessRequest {
	const base = new URL(basePath, window.location.href);
	if (
		base.origin !== window.location.origin ||
		!['/api/v1/auth', '/__next/api/v1/auth'].includes(base.pathname) ||
		base.search ||
		base.hash ||
		base.username ||
		base.password
	) {
		throw new AuthRequestFailure('invalid_input', 'not_dispatched');
	}
	return async <T>(input: AccessRequest<T>): Promise<T> => {
		let body: unknown;
		try {
			body = input.input?.();
		} catch (cause) {
			throw new AuthRequestFailure('invalid_input', 'not_dispatched', null, { cause });
		}
		let result;
		try {
			result = await requestJson({
				method: input.method,
				url: base.href + input.path,
				body,
				maxRequestBytes: input.maxRequestBytes ?? ACCESS_AUTH_REQUEST_MAX_BYTES,
				maxResponseBytes: input.maxResponseBytes ?? ACCESS_AUTH_RESPONSE_MAX_BYTES,
				signal: input.signal,
			});
		} catch (cause) {
			if (cause instanceof HttpRequestFailure) {
				throw new AuthRequestFailure(cause.code, cause.outcome, null, { cause });
			}
			throw new AuthRequestFailure('request_failed', 'unknown', null, { cause });
		}
		if (result.status >= 400) {
			let code;
			try {
				code = input.refused?.(result.status, result.body) ?? readAccessHttpError(result.body).code;
			} catch (cause) {
				throw new AuthRequestFailure('protocol_failure', 'unknown', result.status, { cause });
			}
			throw new AuthRequestFailure(
				code,
				code === 'operation_unknown' || code === 'internal_failure' || code === 'storage_unavailable'
					? 'unknown'
					: 'confirmed',
				result.status,
			);
		}
		if (result.status !== input.status) {
			throw new AuthRequestFailure('protocol_failure', 'unknown', result.status);
		}
		try {
			return input.decode(result.body);
		} catch (cause) {
			throw new AuthRequestFailure('protocol_failure', 'unknown', result.status, { cause });
		}
	};
}

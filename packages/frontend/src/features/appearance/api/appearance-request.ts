import { requestJson, type JsonRequest } from '@/client/http/json-client';
import { requestBinary } from '@/client/http/binary-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { AppearanceRequestFailure, type AppearanceFailureCode } from '../model/appearance-failure';

type WireErrorCode = Exclude<AppearanceFailureCode, 'refresh_required' | HttpRequestFailure['code']> | 'invalid_input';

interface AppearanceRequest<T> {
	method: JsonRequest['method'];
	path: string;
	status?: number;
	maxRequestBytes: number;
	maxResponseBytes: number;
	decode(value: unknown): T;
	decodeError(value: unknown): { code: WireErrorCode };
	input?: () => unknown;
	signal?: AbortSignal;
}

function errorStatus(code: WireErrorCode): number {
	switch (code) {
		case 'invalid_input':
		case 'source_invalid':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
		case 'theme_not_found':
			return 404;
		case 'version_conflict':
		case 'name_conflict':
		case 'preset_readonly':
		case 'source_changed':
			return 409;
		case 'limit_exceeded':
			return 413;
		case 'unsupported_media_type':
			return 415;
		default:
			return 503;
	}
}

function failure(code: WireErrorCode, status: number): never {
	if (status !== errorStatus(code)) {
		throw new AppearanceRequestFailure('protocol_failure', 'unknown');
	}
	const unknown =
		code === 'operation_unknown' ||
		code === 'storage_unavailable' ||
		code === 'internal_failure' ||
		code === 'cleanup_failed';
	throw new AppearanceRequestFailure(code, unknown ? 'unknown' : 'confirmed');
}

function mapFailure(cause: unknown): never {
	if (cause instanceof AppearanceRequestFailure) {
		throw cause;
	}
	if (cause instanceof HttpRequestFailure) {
		throw new AppearanceRequestFailure(cause.code, cause.outcome, { cause });
	}
	throw new AppearanceRequestFailure('protocol_failure', 'unknown', { cause });
}

export async function requestAppearance<T>(input: AppearanceRequest<T>): Promise<T> {
	let body: unknown;
	try {
		body = input.input?.();
	} catch (cause) {
		throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	try {
		const response = await requestJson({
			method: input.method,
			url: '/api/v1' + input.path,
			body,
			maxRequestBytes: input.maxRequestBytes,
			maxResponseBytes: input.maxResponseBytes,
			signal: input.signal,
		});
		if (response.status >= 400) {
			failure(input.decodeError(response.body).code, response.status);
		}
		if (response.status !== (input.status ?? 200)) {
			throw new AppearanceRequestFailure('protocol_failure', 'unknown');
		}
		return input.decode(response.body);
	} catch (cause) {
		return mapFailure(cause);
	}
}

export async function requestAppearanceBytes(input: {
	method: 'GET' | 'POST';
	path: string;
	body?: FormData;
	maxRequestBytes: number;
	maxResponseBytes: number;
	maxErrorBytes: number;
	decodeError(value: unknown): { code: WireErrorCode };
	signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string | null; status: number }> {
	try {
		const response = await requestBinary({
			method: input.method,
			url: '/api/v1' + input.path,
			body: input.body,
			maxRequestBytes: input.maxRequestBytes,
			maxResponseBytes: input.maxResponseBytes,
			maxErrorBytes: input.maxErrorBytes,
			signal: input.signal,
		});
		const contentType = response.headers.get('content-type');
		if (response.status >= 400) {
			if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim())) {
				throw new AppearanceRequestFailure('protocol_failure', 'unknown');
			}
			const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
			failure(input.decodeError(value).code, response.status);
		}
		return { bytes: response.bytes, contentType, status: response.status };
	} catch (cause) {
		return mapFailure(cause);
	}
}

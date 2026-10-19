import type { CommandErrorCode } from '@nexus-terminal/shared/preferences/commands/values';
import type { FavoriteErrorCode } from '@nexus-terminal/shared/preferences/favorites/values';
import type { HistoryErrorCode } from '@nexus-terminal/shared/preferences/history/values';
import { requestJson, type JsonRequest } from '../http/json-client';
import { HttpRequestFailure, type RequestOutcome } from '../http/request-failure';

type PreferenceFailureCode =
	CommandErrorCode | FavoriteErrorCode | HistoryErrorCode | HttpRequestFailure['code'] | 'refresh_required';

export class PreferenceRequestFailure extends Error {
	constructor(
		readonly code: PreferenceFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Personal data request failed', options);
		this.name = 'PreferenceRequestFailure';
	}
}

interface PreferenceRequest<T> {
	method: JsonRequest['method'];
	path: string;
	status: number;
	maxRequestBytes: number;
	maxResponseBytes: number;
	decode(value: unknown): T;
	decodeError(value: unknown): { code: CommandErrorCode | FavoriteErrorCode | HistoryErrorCode };
	input?: () => unknown;
	signal?: AbortSignal;
}

function errorStatus(code: CommandErrorCode | FavoriteErrorCode | HistoryErrorCode): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'version_conflict':
		case 'name_conflict':
			return 409;
		case 'limit_exceeded':
			return 413;
		case 'storage_unavailable':
		case 'operation_unknown':
		case 'internal_failure':
		case 'unavailable':
			return 503;
	}
}

export async function requestPreference<T>(input: PreferenceRequest<T>): Promise<T> {
	let body: unknown;
	try {
		body = input.input?.();
	} catch (cause) {
		throw new PreferenceRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method: input.method,
			url: '/api/v1' + input.path,
			body,
			maxRequestBytes: input.maxRequestBytes,
			maxResponseBytes: input.maxResponseBytes,
			signal: input.signal,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new PreferenceRequestFailure(cause.code, cause.outcome, { cause });
		}
		throw new PreferenceRequestFailure('request_failed', 'unknown', { cause });
	}
	if (response.status >= 400) {
		let code;
		try {
			code = input.decodeError(response.body).code;
			if (errorStatus(code) !== response.status) {
				throw new Error('Inconsistent personal data failure');
			}
		} catch (cause) {
			throw new PreferenceRequestFailure('protocol_failure', 'unknown', { cause });
		}
		const unknown = code === 'operation_unknown' || code === 'storage_unavailable' || code === 'internal_failure';
		throw new PreferenceRequestFailure(code, unknown ? 'unknown' : 'confirmed');
	}
	try {
		if (response.status !== input.status) {
			throw new Error('Unexpected personal data status');
		}
		return input.decode(response.body);
	} catch (cause) {
		throw new PreferenceRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

/** Each domain codec validates its own offset ceiling, page size and response budget. */
export async function listPreferencePages<T extends { id: number }>(
	load: (offset: number) => Promise<{ entries: T[]; nextOffset: number | null }>,
): Promise<T[]> {
	const entries: T[] = [];
	const ids = new Set<number>();
	let offset = 0;
	while (true) {
		const page = await load(offset);
		for (const entry of page.entries) {
			if (ids.has(entry.id)) {
				throw new PreferenceRequestFailure('protocol_failure', 'unknown');
			}
			ids.add(entry.id);
			entries.push(entry);
		}
		if (page.nextOffset === null) {
			return entries;
		}
		if (page.nextOffset <= offset) {
			throw new PreferenceRequestFailure('protocol_failure', 'unknown');
		}
		offset = page.nextOffset;
	}
}

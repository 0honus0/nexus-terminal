import {
	readAccessIpBlacklistQuery,
	readAccessIpBlacklistRemoveRequest,
	readAccessIpBlacklist,
	readAccessIpBlacklistRemove,
	readAccessHttpError,
} from '@nexus-terminal/shared/access/http';
import {
	ACCESS_AUTH_REQUEST_MAX_BYTES,
	ACCESS_IP_BLACKLIST_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { AuthRequestFailure } from '@/features/auth/public';
import type { BlockedAddress } from '../model/security-types';

async function send<T>(
	method: 'GET' | 'DELETE',
	query: string,
	decode: (value: unknown) => T,
	input: () => unknown,
	signal?: AbortSignal,
): Promise<T> {
	let body: unknown;
	try {
		body = input();
	} catch (cause) {
		throw new AuthRequestFailure('invalid_input', 'not_dispatched', null, { cause });
	}
	let response;
	try {
		response = await requestJson({
			method,
			url: '/api/v1/settings/ip-blacklist' + query,
			body,
			signal,
			maxRequestBytes: ACCESS_AUTH_REQUEST_MAX_BYTES,
			maxResponseBytes: ACCESS_IP_BLACKLIST_RESPONSE_MAX_BYTES,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new AuthRequestFailure(cause.code, cause.outcome, null, { cause });
		}
		throw new AuthRequestFailure('request_failed', 'unknown', null, { cause });
	}
	if (response.status >= 400) {
		let code;
		try {
			code = readAccessHttpError(response.body).code;
		} catch (cause) {
			throw new AuthRequestFailure('protocol_failure', 'unknown', response.status, { cause });
		}
		throw new AuthRequestFailure(
			code,
			['operation_unknown', 'storage_unavailable', 'internal_failure'].includes(code) ? 'unknown' : 'confirmed',
			response.status,
		);
	}
	try {
		if (response.status !== 200) {
			throw new Error('Unexpected blacklist response');
		}
		return decode(response.body);
	} catch (cause) {
		throw new AuthRequestFailure('protocol_failure', 'unknown', response.status, { cause });
	}
}

export const ipBlacklistApi = {
	list(limit: number, offset: number, signal?: AbortSignal): Promise<{ entries: BlockedAddress[]; total: number }> {
		const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
		return send(
			'GET',
			'?' + query.toString(),
			(value) => {
				const page = readAccessIpBlacklist(value);
				const remaining = Math.max(0, page.total - offset);
				if (
					page.entries.length > limit ||
					page.entries.length > remaining ||
					new Set(page.entries.map((entry) => entry.ip)).size !== page.entries.length
				) {
					throw new Error('Invalid blacklist page');
				}
				return {
					entries: page.entries.map((entry) => ({
						ip: entry.ip,
						attempts: entry.attempts,
						lastAttemptAtMs: entry.lastAttemptAt * 1000,
						blockedUntilMs: entry.blockedUntil === null ? null : entry.blockedUntil * 1000,
					})),
					total: page.total,
				};
			},
			() => {
				readAccessIpBlacklistQuery(query);
				return undefined;
			},
			signal,
		);
	},

	async remove(ip: string, signal?: AbortSignal): Promise<void> {
		await send('DELETE', '', readAccessIpBlacklistRemove, () => readAccessIpBlacklistRemoveRequest({ ip }), signal);
	},
};

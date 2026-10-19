import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { InvalidTargetPayload, targetNumber } from '@nexus-terminal/shared/targets/http';
import { CONNECTION_TEST_BODY_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import {
	readUnsavedSshTest,
	readConnectionTestResponse,
	readConnectionTestFailure,
} from '@nexus-terminal/shared/targets/connections/test-codec';
import type { UnsavedSshTestInput } from '@nexus-terminal/shared/targets/connections/test-http';
import { ConnectionTestFailure } from '../model/connection-errors';
import type { ConnectionTestErrorCode } from '@nexus-terminal/shared/targets/connections/values';

function failureStatus(code: ConnectionTestErrorCode): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'reference_not_found':
			return 404;
		case 'conflict':
			return 409;
		case 'host_key_untrusted':
		case 'unresolvable':
		case 'connection_failed':
			return 422;
		case 'limit_exceeded':
			return 429;
		case 'internal_failure':
			return 500;
		case 'cleanup_failed':
		case 'storage_unavailable':
		case 'unavailable':
		case 'shutting_down':
			return 503;
	}
}

async function test(path: string, input: () => unknown, signal?: AbortSignal): Promise<number> {
	let body: unknown;
	try {
		body = input();
	} catch (cause) {
		throw new ConnectionTestFailure('invalid_input', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method: 'POST',
			url: '/api/v1/targets' + path,
			body,
			maxRequestBytes: CONNECTION_TEST_BODY_MAX_BYTES,
			maxResponseBytes: CONNECTION_TEST_BODY_MAX_BYTES,
			signal,
		});
	} catch (cause) {
		throw new ConnectionTestFailure(cause instanceof HttpRequestFailure ? cause.code : 'request_failed', { cause });
	}
	if (response.status >= 400) {
		let code: ConnectionTestErrorCode;
		try {
			code = readConnectionTestFailure(response.body).code;
			if (failureStatus(code) !== response.status) {
				throw new InvalidTargetPayload();
			}
		} catch (cause) {
			throw new ConnectionTestFailure('protocol_failure', { cause });
		}
		throw new ConnectionTestFailure(code);
	}
	try {
		if (response.status !== 200) {
			throw new InvalidTargetPayload();
		}
		return readConnectionTestResponse(response.body).latencyMs;
	} catch (cause) {
		throw new ConnectionTestFailure('protocol_failure', { cause });
	}
}

export const connectionTestApi = {
	saved(id: number, signal?: AbortSignal): Promise<number> {
		return test(
			`/connections/${id}/test`,
			() => {
				targetNumber(id);
				return undefined;
			},
			signal,
		);
	},

	unsaved(input: UnsavedSshTestInput, signal?: AbortSignal): Promise<number> {
		return test('/connections/test-unsaved', () => readUnsavedSshTest(input), signal);
	},
};

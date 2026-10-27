import { readLocalSystemStatus, readLocalSystemStatusError } from '@nexus-terminal/shared/system/status/http-codec';
import { SYSTEM_STATUS_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/system/status/values';
import { readObservationError, readSshResourceStatus } from '@nexus-terminal/shared/remote/monitoring/http-codec';
import {
	OBSERVATION_MAX_RESPONSE_BYTES,
	type ObservationErrorCode,
} from '@nexus-terminal/shared/remote/monitoring/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import {
	ResourceFailure,
	type LocalResourceStatus,
	type SshResource,
	type SshResourceTarget,
} from '../model/system-overview-types';
import { resourceKey, toLocalResource, toSshResource } from '../model/system-overview-mapper';

const observationStatus: Record<ObservationErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	limit_exceeded: 429,
	conflict: 409,
	remote_unavailable: 503,
	command_failed: 502,
	operation_unknown: 503,
	host_key_untrusted: 403,
};

async function get<T>(
	path: string,
	maxResponseBytes: number,
	decode: (value: unknown) => T,
	failure: (status: number, body: unknown) => ResourceFailure,
	signal?: AbortSignal,
): Promise<T> {
	let response;
	try {
		response = await requestJson({
			method: 'GET',
			url: '/api/v1/system/' + path,
			maxRequestBytes: 1,
			maxResponseBytes,
			signal,
		});
	} catch (cause) {
		throw new ResourceFailure(cause instanceof HttpRequestFailure ? cause.code : 'request_failed', { cause });
	}
	try {
		if (response.status !== 200) {
			throw failure(response.status, response.body);
		}
		return decode(response.body);
	} catch (cause) {
		if (cause instanceof ResourceFailure) {
			throw cause;
		}
		throw new ResourceFailure('protocol_failure', { cause });
	}
}

export const systemOverviewApi = {
	async local(signal?: AbortSignal): Promise<LocalResourceStatus> {
		const value = await get(
			'status',
			SYSTEM_STATUS_MAX_RESPONSE_BYTES,
			readLocalSystemStatus,
			(status, body) => {
				const { code } = readLocalSystemStatusError(body);
				const expected =
					code === 'invalid_input'
						? 400
						: code === 'unauthenticated'
							? 401
							: code === 'forbidden'
								? 403
								: 503;
				if (status !== expected) {
					throw new ResourceFailure('protocol_failure');
				}
				return new ResourceFailure(code);
			},
			signal,
		);
		return toLocalResource(value, Date.now());
	},

	async ssh(target: SshResourceTarget, signal?: AbortSignal): Promise<SshResource> {
		if (!Number.isSafeInteger(target.id) || target.id < 1) {
			throw new ResourceFailure('invalid_input');
		}
		const value = await get(
			`ssh-resources/${target.id}`,
			OBSERVATION_MAX_RESPONSE_BYTES,
			readSshResourceStatus,
			(status, body) => {
				const { code } = readObservationError(body);
				if (status !== observationStatus[code]) {
					throw new ResourceFailure('protocol_failure');
				}
				return new ResourceFailure(code);
			},
			signal,
		);
		const expectedKey = resourceKey(target.host, target.port);
		// The producer can try another connection to the same host; its ID/username may differ.
		if (value.key !== expectedKey || resourceKey(value.host, value.port) !== expectedKey) {
			throw new ResourceFailure('protocol_failure');
		}
		return toSshResource(value);
	},
};

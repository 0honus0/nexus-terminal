import { rejectAgentManagementResponse } from './management-errors';

export { rejectAgentManagementResponse, agentManagementErrorStatus } from './management-errors';

import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { AgentManagementFailure } from '../model/management-failure';

export interface ManagementRequest<T> {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	expectedStatus?: 200 | 201 | readonly (200 | 201)[];
	path: string;
	apiBase?: '/api/v1/agent' | '/api/v1/apps' | '/__next/api/v1/agent';
	headers?: () => Readonly<Record<string, string>>;
	maxRequestBytes: number;
	maxResponseBytes: number;
	input?: () => unknown;
	decode(value: unknown, status: number): T;
	signal?: AbortSignal;
}

export async function requestAgentManagement<T>(input: ManagementRequest<T>): Promise<T> {
	let body: unknown;
	let headers: Readonly<Record<string, string>> | undefined;
	try {
		body = input.input?.();
		headers = input.headers?.();
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	let response;
	try {
		response = await requestJson({
			method: input.method,
			url: (input.apiBase ?? '/api/v1/agent') + input.path,
			headers,
			body,
			signal: input.signal,
			maxRequestBytes: input.maxRequestBytes,
			maxResponseBytes: input.maxResponseBytes,
		});
	} catch (cause) {
		if (cause instanceof HttpRequestFailure) {
			throw new AgentManagementFailure(cause.code, cause.outcome, { cause });
		}
		throw new AgentManagementFailure('request_failed', 'unknown', { cause });
	}
	if (response.status >= 400) {
		rejectAgentManagementResponse(response.status, response.body);
	}
	try {
		const expected = input.expectedStatus ?? 200;
		if (
			typeof expected === 'number'
				? response.status !== expected
				: !expected.some((status) => status === response.status)
		) {
			throw new Error('Unexpected Agent response status');
		}
		return input.decode(response.body, response.status);
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
}

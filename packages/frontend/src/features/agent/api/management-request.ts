import { readAgentErrorResponse } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import { requestJson } from '@/client/http/json-client';
import { HttpRequestFailure } from '@/client/http/request-failure';
import { AgentManagementFailure } from '../model/management-failure';

interface ManagementRequest<T> {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	expectedStatus?: 200 | 201;
	path: string;
	apiBase?: '/api/v1/agent' | '/api/v1/apps' | '/__next/api/v1/agent';
	headers?: () => Readonly<Record<string, string>>;
	maxRequestBytes: number;
	maxResponseBytes: number;
	input?: () => unknown;
	decode(value: unknown): T;
	signal?: AbortSignal;
}

export function agentManagementErrorStatus(code: AgentHttpErrorCode): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
		case 'csrf_rejected':
		case 'invalid_host':
		case 'app_disabled':
		case 'execution_disabled':
		case 'capability_undeclared':
		case 'target_denied':
			return 403;
		case 'invalid_input':
		case 'invalid_json':
		case 'invalid_path':
			return 400;
		case 'unsupported_media_type':
			return 415;
		case 'not_found':
		case 'model_not_found':
			return 404;
		case 'active_run_conflict':
		case 'idempotency_conflict':
		case 'approval_stale':
		case 'version_conflict':
		case 'provider_in_use':
		case 'provider_configuration_stale':
			return 409;
		case 'body_too_large':
		case 'limit_exceeded':
			return 413;
		case 'storage_unavailable':
		case 'provider_unavailable':
		case 'provider_request_failed':
		case 'operation_unknown':
		case 'shutting_down':
			return 503;
		case 'internal_failure':
			return 500;
	}
}

export function rejectAgentManagementResponse(status: number, value: unknown): never {
	let code: AgentHttpErrorCode;
	try {
		code = readAgentErrorResponse(value).code;
		if (agentManagementErrorStatus(code) !== status) {
			throw new Error('Inconsistent Agent failure');
		}
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
	const unknown = code === 'operation_unknown' || code === 'storage_unavailable' || code === 'internal_failure';
	throw new AgentManagementFailure(code, unknown ? 'unknown' : 'confirmed');
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
		if (response.status !== (input.expectedStatus ?? 200)) {
			throw new Error('Unexpected Agent response status');
		}
		return input.decode(response.body);
	} catch (cause) {
		throw new AgentManagementFailure('protocol_failure', 'unknown', { cause });
	}
}

import { readAgentErrorResponse } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import { AgentManagementFailure } from '../model/management-failure';

export function agentManagementErrorStatus(code: AgentHttpErrorCode): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'host_key_untrusted':
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
		case 'not_text':
		case 'unsupported_media_type':
			return 415;
		case 'not_found':
		case 'model_not_found':
			return 404;
		case 'mutation_busy':
		case 'mutation_blocked':
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
		case 'remote_unavailable':
		case 'provider_unavailable':
		case 'provider_request_failed':
		case 'operation_unknown':
		case 'shutting_down':
			return 503;
		case 'command_failed':
			return 422;
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

import type { AgentOperationError } from '../../public-errors.js';

export function agentErrorStatus(code: AgentOperationError['code']): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'execution_disabled':
		case 'app_disabled':
		case 'capability_undeclared':
		case 'target_denied':
			return 403;
		case 'limit_exceeded':
			return 413;
		case 'invalid_input':
			return 400;
		case 'not_found':
			return 404;
		case 'active_run_conflict':
		case 'idempotency_conflict':
		case 'approval_stale':
		case 'version_conflict':
		case 'provider_in_use':
		case 'provider_configuration_stale':
			return 409;
		case 'model_not_found':
			return 404;
		case 'provider_unavailable':
		case 'provider_request_failed':
		case 'storage_unavailable':
		case 'operation_unknown':
			return 503;
		case 'internal_failure':
			return 500;
	}
}

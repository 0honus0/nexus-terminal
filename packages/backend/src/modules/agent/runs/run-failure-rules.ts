import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import {
	AgentFailure,
	isAgentStorageStatementFailure,
	ContextLimitExceeded,
	ProviderRequestFailure,
	ToolOperationRefusal,
	ToolCapabilityDenied,
} from '../agent-failure.js';

/** Finite diagnostics only: never persist an exception message or vendor response. */
export function runFailureCode(error: unknown, tool = false, timedOut = false): AgentRunFailureCode {
	if (timedOut) {
		return 'tool_timeout';
	}
	if (error instanceof AggregateError) {
		const fallback = tool ? 'tool_failed' : 'execution_failed';
		return (
			error.errors.map((cause: unknown) => runFailureCode(cause, tool)).find((code) => code !== fallback) ??
			fallback
		);
	}
	if (isAgentStorageStatementFailure(error)) {
		return 'execution_storage_failed';
	}
	if (error instanceof ProviderRequestFailure) {
		switch (error.errorCode) {
			case 'PROVIDER_HTTP_401':
			case 'PROVIDER_HTTP_403':
				return 'model_auth_failed';
			case 'PROVIDER_HTTP_429':
				return 'model_rate_limited';
			case 'PROVIDER_HTTP_400':
			case 'PROVIDER_HTTP_422':
				return 'model_request_rejected';
			case 'PROVIDER_HTTP_404':
				return 'model_not_found';
			case 'PROVIDER_HTTP_500':
			case 'PROVIDER_HTTP_502':
			case 'PROVIDER_HTTP_503':
			case 'PROVIDER_HTTP_504':
				return 'model_service_unavailable';
			case 'PROVIDER_OUTPUT_TRUNCATED':
				return 'model_output_limit';
			case 'PROVIDER_CONTENT_FILTERED':
				return 'model_content_filtered';
			case 'PROVIDER_RESPONSE_TOO_LARGE':
				return 'model_response_too_large';
			case 'PROVIDER_STREAM_CLEANUP_FAILED':
				return 'model_cleanup_failed';
			case 'PROVIDER_NETWORK_TIMEOUT':
				return 'model_timeout';
			case 'PROVIDER_RESPONSE_INVALID':
				return 'model_response_invalid';
			case 'PROVIDER_RESPONSE_EMPTY':
				return 'model_response_empty';
			case 'PROVIDER_STREAM_TRUNCATED':
				return 'model_stream_truncated';
			case 'PROVIDER_DNS_FAILED':
				return 'model_dns_failed';
			case 'PROVIDER_TLS_FAILED':
				return 'model_tls_failed';
			case 'PROVIDER_NETWORK_FAILED':
				return 'model_network_failed';
			default:
				return 'model_failed';
		}
	}
	if (error instanceof ToolOperationRefusal) {
		if (!tool) {
			return 'execution_failed';
		}
		switch (error.code) {
			case 'host_key_untrusted':
				return 'tool_host_untrusted';
			case 'remote_unavailable':
				return 'tool_target_unavailable';
			case 'not_found':
				return 'tool_resource_not_found';
			case 'forbidden':
				return 'tool_remote_permission_denied';
			case 'command_failed':
				return 'tool_command_failed';
			case 'not_text':
				return 'tool_invalid_input';
		}
	}
	if (error instanceof ToolCapabilityDenied) {
		return tool ? 'tool_capability_missing' : 'execution_not_authorized';
	}
	if (error instanceof ContextLimitExceeded) {
		return 'context_limit_exceeded';
	}
	if (error instanceof AgentFailure) {
		switch (error.code) {
			case 'forbidden':
				return tool ? 'tool_not_authorized' : 'execution_not_authorized';
			case 'capability_undeclared':
				return tool ? 'tool_capability_undeclared' : 'execution_not_authorized';
			case 'target_denied':
				return tool ? 'tool_target_denied' : 'execution_not_authorized';
			case 'app_disabled':
				return tool ? 'tool_app_disabled' : 'execution_not_authorized';
			case 'execution_disabled':
				return tool ? 'tool_not_authorized' : 'execution_not_authorized';
			case 'invalid_input':
				return tool ? 'tool_invalid_input' : 'execution_failed';
			case 'not_found':
				return tool ? 'tool_target_unavailable' : 'configuration_changed';
			case 'limit_exceeded':
				return tool ? 'tool_limit_exceeded' : 'execution_limit_exceeded';
			case 'version_conflict':
			case 'provider_configuration_stale':
			case 'provider_unavailable':
				return tool ? 'tool_state_changed' : 'configuration_changed';
			case 'approval_stale':
				return tool ? 'tool_approval_expired' : 'execution_not_authorized';
		}
	}
	return tool ? 'tool_failed' : 'execution_failed';
}

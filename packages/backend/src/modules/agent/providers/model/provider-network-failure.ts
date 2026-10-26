import type { AgentProviderFailureCode } from '@nexus-terminal/shared/agent/providers/values';
import { ModelNetworkFailure } from '../../../../platform/ai/model-port.js';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';

/** One technical→application failure conversion for Provider probes and Run streams. */
export function toProviderRequestFailure(error: unknown): AgentFailure {
	if (error instanceof AgentFailure) {
		return error;
	}
	if (!(error instanceof ModelNetworkFailure)) {
		return new ProviderRequestFailure('PROVIDER_NETWORK_FAILED', { cause: error });
	}
	const codes = {
		http: 'PROVIDER_HTTP_ERROR',
		content_filtered: 'PROVIDER_CONTENT_FILTERED',
		dns: 'PROVIDER_DNS_FAILED',
		tls: 'PROVIDER_TLS_FAILED',
		network: 'PROVIDER_NETWORK_FAILED',
		timeout: 'PROVIDER_NETWORK_TIMEOUT',
		response_invalid: 'PROVIDER_RESPONSE_INVALID',
		response_empty: 'PROVIDER_RESPONSE_EMPTY',
		stream_truncated: 'PROVIDER_STREAM_TRUNCATED',
		too_large: 'PROVIDER_RESPONSE_TOO_LARGE',
		cleanup_failed: 'PROVIDER_STREAM_CLEANUP_FAILED',
	} as const;
	const status = error.httpStatus;
	const code: AgentProviderFailureCode =
		error.kind === 'http' && status !== undefined && Number.isSafeInteger(status) && status >= 100 && status <= 599
			? `PROVIDER_HTTP_${status}`
			: codes[error.kind];
	return new ProviderRequestFailure(code, { cause: error });
}

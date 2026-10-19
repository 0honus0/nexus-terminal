import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';

export class AgentManagementFailure extends Error {
	constructor(
		readonly code: AgentHttpErrorCode | HttpRequestFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Agent management request failed', options);
		this.name = 'AgentManagementFailure';
	}
}

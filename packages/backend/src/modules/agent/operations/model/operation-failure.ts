import { AgentFailure, AgentResourceFenced } from '../../agent-failure.js';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { OperationReceipt } from './operation-types.js';

/** A committed unknown receipt fences its Run; it is not evidence of a failed local drain. */
export function operationReceiptFailure(receipt: OperationReceipt, fallback: AgentOperationErrorCode): AgentFailure {
	return receipt.state === 'unknown' ? new AgentResourceFenced() : new AgentFailure(receipt.failureCode ?? fallback);
}

/** Raised only by the trusted admission callback before the dispatch transaction commits. */
export class OperationDispatchRefusal extends AgentFailure {
	constructor(failure: AgentFailure) {
		super(failure.code, { cause: failure });
		this.name = 'OperationDispatchRefusal';
	}
}

/** Evidence is supplied by the trusted I/O owner, independently of the plugin's handler result. */
export class OperationEffectFailure extends AgentFailure {
	constructor(
		code: AgentOperationErrorCode,
		readonly effect: 'not_started' | 'confirmed' | 'unknown',
		readonly cleanup: 'closed' | 'unknown',
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'OperationEffectFailure';
	}
}

import {
	AGENT_APPROVAL_MAX_PAGE_ITEMS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_MAX_FEEDBACK_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateUserId, validateOperationKey } from '../../agent-validation.js';
import type { RunChanges } from '../../runs/model/run-changes.js';
import type { OperationApprovalModel } from '../model/operation-approval-model.js';
import type {
	OperationApproval,
	OperationApprovalActor,
	OperationApprovalRequest,
	OperationApprovalDecision,
	OperationApprovalPage,
} from '../model/operation-approval-types.js';

/** Approval waiting follows actual state invalidations and the saved expiry, with no polling. */
export class OperationApprovalService {
	constructor(
		private readonly model: OperationApprovalModel,
		private readonly changes: RunChanges,
	) {}

	async permit(input: OperationApprovalRequest, signal: AbortSignal): Promise<{ id: string; version: number }> {
		const scope = input.operation.scope;
		const requested = await this.changes.after(scope, () => this.model.request(input));
		let revision = 0;
		let wake: (() => void) | null = null;
		let stopped = false;

		const notify = () => {
			revision++;
			wake?.();
		};

		const unsubscribe = this.changes.subscribe(
			scope,
			notify,
			() => {
				stopped = true;
				notify();
			},
			(change) => change.runId === undefined || change.runId === scope.runId,
		);
		signal.addEventListener('abort', notify);
		try {
			for (;;) {
				signal.throwIfAborted();
				if (stopped) {
					throw new AgentFailure('provider_unavailable');
				}
				const observed = revision;
				const current = await this.model.get(scope.userId, scope.appId, input.operation.id);
				if (!current || current.id !== requested.id || current.policyRevision !== input.policyRevision) {
					throw new AgentFailure('version_conflict');
				}
				if (current.status === 'superseded') {
					throw new AgentFailure('version_conflict');
				}
				if (current.status === 'approved' && current.expiresAt > Date.now() && current.consumedAt === null) {
					return { id: current.id, version: current.version };
				}
				if (current.status !== 'requested' || current.expiresAt <= Date.now()) {
					throw new AgentFailure('forbidden');
				}
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					await new Promise<void>((resolve) => {
						wake = resolve;
						timer = setTimeout(resolve, Math.max(1, current.expiresAt - Date.now()));
						if (revision !== observed || signal.aborted || stopped) {
							resolve();
						}
					});
				} finally {
					wake = null;
					clearTimeout(timer);
				}
			}
		} finally {
			unsubscribe();
			signal.removeEventListener('abort', notify);
		}
	}

	list(
		userId: number,
		appId: string,
		runId: string,
		before: string | null,
		limit: number,
	): Promise<OperationApproval[]> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(runId);
		this.validateCursor(before);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_APPROVAL_MAX_PAGE_ITEMS) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.list(userId, appId, runId, before, limit);
	}

	private validateCursor(value: string | null): void {
		if (value !== null && (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)))) {
			throw new AgentFailure('invalid_input');
		}
	}

	get(userId: number, appId: string, approvalId: string): Promise<OperationApproval | null> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(approvalId);
		return this.model.getApproval(userId, appId, approvalId);
	}

	async page(userId: number, appId: string, runId: string, after: string | null): Promise<OperationApprovalPage> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(runId);
		this.validateCursor(after);
		const found = await this.model.list(userId, appId, runId, after, AGENT_APPROVAL_MAX_PAGE_ITEMS + 1);
		const items = found.slice(0, AGENT_APPROVAL_MAX_PAGE_ITEMS);
		return {
			items,
			after,
			nextCursor: items.length ? String(items[items.length - 1].sequence) : after,
			hasMore: found.length > items.length,
		};
	}

	async resolve(actor: OperationApprovalActor, command: OperationApprovalDecision): Promise<OperationApproval> {
		validateUserId(actor.userId);
		validateAgentId(command.appId);
		validateAgentId(command.approvalId);
		validateOperationKey(command.operationKey);
		if (
			!Number.isSafeInteger(command.expectedVersion) ||
			command.expectedVersion < 1 ||
			!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(command.operationHash) ||
			(command.decision !== 'approved' && command.decision !== 'denied') ||
			(command.feedback !== undefined && Buffer.byteLength(command.feedback) > AGENT_APPROVAL_MAX_FEEDBACK_BYTES)
		) {
			throw new AgentFailure('invalid_input');
		}
		// An uncertain commit also invalidates readers; no success fact is invented.
		return this.changes.after({ userId: actor.userId, appId: command.appId }, () =>
			this.model.resolve(actor, command),
		);
	}
}

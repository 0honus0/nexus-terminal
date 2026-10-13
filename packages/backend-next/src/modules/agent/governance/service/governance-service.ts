import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_TTL_SECONDS,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
	AGENT_APPROVAL_MAX_SUMMARY_BYTES,
	AGENT_APPROVAL_MAX_FEEDBACK_BYTES,
	AGENT_APPROVAL_KINDS,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_DECISIONS,
} from '@nexus-terminal/shared/agent/governance/values';
import { createHash } from 'node:crypto';
import { validateAgentId, validateUserId, validateOperationKey } from '../../agent-validation.js';
import {
	capabilityDefinitions,
	authorizationFact,
	validOverrides,
	effectivePolicy,
	mayResolve,
	approvalTransition,
	mayRequestApproval,
	grantChangeDecision,
	executionChangeDecision,
	mayReplaceGrants,
} from '../governance-rules.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	GrantInput,
	ApprovalRequest,
	ResolveApproval,
	GrantState,
	PolicyOverrides,
	ExecutionPolicy,
	ExecutionPolicyFacts,
	Approval,
	GrantCatalogState,
} from '../model/governance-types.js';
import type { GovernanceModel } from '../model/governance-model.js';
import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';

/** Single lifecycle owner for governance queries, mutations and lazy approval expiration.
 * No unowned timer: expiry is committed at each access or decision in the original transaction.
 */
export class GovernanceService {
	private readonly pending = new Set<Promise<unknown>>();
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly closeFailures: unknown[] = [];
	private droppedFailures = 0;

	constructor(private readonly model: GovernanceModel) {}

	private async admitted<T>(action: () => Promise<T>, inheritedCleanup = false): Promise<T> {
		// Cancellation accepted before quiesce must still finish its post-commit revoke.
		// AgentRequestOwner drains its admitted requests before closing this sub-owner.
		if (this.closing && (!inheritedCleanup || this.closePromise !== null)) {
			throw new AgentFailure('provider_unavailable');
		}
		const pending = Promise.resolve().then(action);
		this.pending.add(pending);
		try {
			return await pending;
		} catch (error) {
			if (isAgentDrainFailure(error)) {
				if (this.closeFailures.length < 32) {
					this.closeFailures.push(error);
				} else {
					this.droppedFailures++;
				}
			}
			throw error;
		} finally {
			this.pending.delete(pending);
		}
	}

	grants(userId: number, appId: string): Promise<GrantCatalogState | null> {
		validateScope(userId, appId);
		return this.admitted(async () => toGrantCatalog(await this.model.grants(userId, appId)));
	}

	replaceGrants(
		userId: number,
		appId: string,
		expected: number,
		input: GrantInput[],
	): Promise<GrantCatalogState | null> {
		validateUserId(userId);
		validateAgentId(appId);
		if (
			!Number.isSafeInteger(expected) ||
			expected < 0 ||
			input.some((g) => !AGENT_CAPABILITIES.includes(g.capability)) ||
			!mayReplaceGrants(input, expected, expected)
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(async () =>
			toGrantCatalog(
				await this.model.replaceGrants(userId, appId, expected, input, now(), (current) =>
					grantChangeDecision(input, current.revision, expected),
				),
			),
		);
	}

	execution(userId: number, appId: string): Promise<ExecutionPolicy | null> {
		validateScope(userId, appId);
		return this.admitted(async () => toExecutionPolicy(await this.model.execution(userId, appId)));
	}

	replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: PolicyOverrides,
	): Promise<ExecutionPolicy | null> {
		validateScope(userId, appId);
		if (!Number.isSafeInteger(version) || version < 0 || !validOverrides(overrides)) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(async () =>
			toExecutionPolicy(
				await this.model.replaceExecution(userId, appId, version, overrides, (current) =>
					executionChangeDecision(current.version, version, current.overrides, overrides),
				),
			),
		);
	}

	approval(userId: number, appId: string, id: string): Promise<Approval | null> {
		validateScope(userId, appId);
		validateAgentId(id);
		return this.admitted(() => this.model.approval(userId, appId, id, now, approvalTransition));
	}

	approvals(userId: number, appId: string, runId: string): Promise<Approval[] | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.admitted(() => this.model.approvals(userId, appId, runId, now, approvalTransition));
	}

	request(input: ApprovalRequest): Promise<Approval | null> {
		validateUserId(input.userId);
		for (const id of [input.appId, input.runId, input.toolCallId, input.id]) {
			validateAgentId(id);
		}
		if (
			!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(input.operationHash) ||
			!Number.isSafeInteger(input.inputRevision) ||
			input.inputRevision < 1 ||
			new TextEncoder().encode(input.inspection.toolName).length > AGENT_APPROVAL_MAX_TOOL_NAME_BYTES ||
			new TextEncoder().encode(input.inspection.toolVersion).length > AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES ||
			new TextEncoder().encode(input.inspection.summary).length > AGENT_APPROVAL_MAX_SUMMARY_BYTES ||
			!input.inspection.toolName.trim() ||
			!input.inspection.toolVersion.trim() ||
			!input.inspection.summary.trim() ||
			!AGENT_CAPABILITIES.includes(input.capability) ||
			!AGENT_APPROVAL_KINDS.includes(input.kind) ||
			!AGENT_APPROVAL_RISKS.includes(input.inspection.risk) ||
			typeof input.inspection.mutation !== 'boolean'
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(() =>
			this.model.request(input, (policy, status, version) => {
				if (
					!authorizationFact(policy, input.capability, input.connectionId).allowed ||
					!mayRequestApproval(
						status,
						version,
						input.inputRevision,
						input.inspection.risk,
						input.connectionId,
						input.inspection.targetConnectionId,
					)
				) {
					return null;
				}
				const requestedAt = now();
				return createRequestedApproval(input, policy.revision, requestedAt);
			}),
		);
	}

	resolve(input: ResolveApproval): Promise<Approval> {
		validateUserId(input.userId);
		for (const id of [input.appId, input.approvalId]) {
			validateAgentId(id);
		}
		validateOperationKey(input.operationKey);
		if (
			!AGENT_APPROVAL_DECISIONS.includes(input.decision) ||
			!Number.isSafeInteger(input.expectedVersion) ||
			input.expectedVersion < 1 ||
			!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(input.operationHash) ||
			(input.feedback !== undefined &&
				(!input.feedback.trim() ||
					new TextEncoder().encode(input.feedback).length > AGENT_APPROVAL_MAX_FEEDBACK_BYTES))
		) {
			throw new AgentFailure('invalid_input');
		}
		const hash = createHash('sha256')
			.update(
				JSON.stringify({
					appId: input.appId,
					approvalId: input.approvalId,
					decision: input.decision,
					operationHash: input.operationHash,
					expectedVersion: input.expectedVersion,
					feedback: input.feedback ?? null,
				}),
			)
			.digest('hex');
		return this.admitted(() =>
			this.model.resolve(
				{
					userId: input.userId,
					appId: input.appId,
					approvalId: input.approvalId,
					decision: input.decision,
					operationHash: input.operationHash,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationKey,
					feedback: input.feedback,
				},
				hash,
				now,
				approvalTransition,
				(approval, policy, status, version, time) =>
					mayResolve(
						approval,
						policy.revision,
						status,
						version,
						input.operationHash,
						input.expectedVersion,
						time,
					),
			),
		);
	}

	invalidate(userId: number, appId: string, runId: string): Promise<number> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.admitted(() => this.model.invalidate(userId, appId, runId, now, approvalTransition), true);
	}

	quiesce(): void {
		this.closing = true;
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		const active = [...this.pending];
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled(active);
			if (this.closeFailures.length || this.droppedFailures) {
				throw new AggregateError(
					[
						...this.closeFailures,
						...(this.droppedFailures
							? [new Error('Additional governance close failures: ' + this.droppedFailures)]
							: []),
					],
					'Agent governance close failed',
				);
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}

function now(): number {
	return Math.floor(Date.now() / 1000);
}

function validateScope(userId: number, appId: string): void {
	validateUserId(userId);
	validateAgentId(appId);
}

function toExecutionPolicy(facts: ExecutionPolicyFacts | null): ExecutionPolicy | null {
	if (facts === null) {
		return null;
	}
	if (!validOverrides(facts.overrides)) {
		throw new AgentFailure('internal_failure');
	}
	return { version: facts.version, overrides: facts.overrides, effective: effectivePolicy(facts.overrides) };
}

function toGrantCatalog(state: GrantState | null): GrantCatalogState | null {
	return state === null
		? null
		: {
				appId: state.appId,
				userId: state.userId,
				revision: state.revision,
				grants: state.grants,
				definitions: capabilityDefinitions(),
			};
}

function createRequestedApproval(input: ApprovalRequest, policyRevision: number, requestedAt: number): Approval {
	return {
		id: input.id,
		userId: input.userId,
		appId: input.appId,
		runId: input.runId,
		toolCallId: input.toolCallId,
		operationHash: input.operationHash,
		kind: input.kind,
		status: 'requested',
		policyRevision,
		inputRevision: input.inputRevision,
		version: 1,
		requestedAt: requestedAt,
		expiresAt: requestedAt + AGENT_APPROVAL_TTL_SECONDS,
		decidedAt: null,
		decidedByUserId: null,
		consumedAt: null,
		feedback: null,
		inspection: {
			toolName: input.inspection.toolName,
			toolVersion: input.inspection.toolVersion,
			risk: input.inspection.risk,
			mutation: input.inspection.mutation,
			targetConnectionId: input.inspection.targetConnectionId,
			summary: input.inspection.summary,
		},
	};
}

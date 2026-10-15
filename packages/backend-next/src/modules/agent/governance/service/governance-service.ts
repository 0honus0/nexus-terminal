import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { RevokeRuns } from '../../runs/model/run-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { ConsumeApproval } from '../model/governance-types.js';
import type { ToolAuthorityIdentity, ToolAuthorityTask, ToolAuthority } from '../model/governance-types.js';
import { mayReadTool, mayUseTool, mayUseConsumedApproval } from '../governance-rules.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import {
	AGENT_DENYLIST_MAX_TARGETS,
	AGENT_DENYLIST_MAX_REASON_BYTES,
	AGENT_DENYLIST_MAX_REASON_CODE_POINTS,
} from '@nexus-terminal/shared/agent/governance/values';
import type { DenylistCommand, TargetDenylist, DenylistTarget, DenylistMutation } from '../model/governance-types.js';
import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_TTL_SECONDS,
	AGENT_APPROVAL_MAX_FEEDBACK_BYTES,
	AGENT_APPROVAL_KINDS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_DECISIONS,
} from '@nexus-terminal/shared/agent/governance/values';
import { createHash } from 'node:crypto';
import { validateAgentId, validateUserId, validateOperationKey } from '../../agent-validation.js';
import {
	capabilityDefinitions,
	authorizationFact,
	validOverrides,
	mayResolve,
	mayConsumeApproval,
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
	ApprovalOperation,
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

	constructor(
		private readonly model: GovernanceModel,
		private readonly revoke: RevokeRuns,
		private readonly events: OperationsEvents,
		private readonly settings: ExecutionService,
	) {}

	/** Current tool authority. Only a read-only operation can dispatch without approval. */
	toolAuthority(input: ToolAuthorityIdentity, task: ToolAuthorityTask): Promise<ToolAuthority | null> {
		validateScope(input.userId, input.appId);
		validateAgentId(input.runId);
		validateAgentId(input.id);
		if (
			!Number.isSafeInteger(input.expectedRevision) ||
			input.expectedRevision < 1 ||
			!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(input.operationHash) ||
			(task.kind !== 'dispatch' && (!Number.isSafeInteger(task.policyRevision) || task.policyRevision < 0)) ||
			(task.kind === 'complete' && Buffer.byteLength(task.resultText, 'utf8') > TOOL_RESULT_MAX_BYTES)
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(() =>
			this.model.toolAuthority(
				input,
				task,
				task.kind === 'dispatch' ? mayReadTool : mayUseTool,
				mayUseConsumedApproval,
			),
		);
	}

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
				await this.model.replaceGrants(userId, appId, expected, input, now(), (current) => {
					if (
						!current.app.declared ||
						input.some((grant) => !current.app.capabilities.includes(grant.capability))
					) {
						throw new AgentFailure('capability_undeclared');
					}
					return grantChangeDecision(input, current.revision, expected);
				}),
			),
		);
	}

	execution(userId: number, appId: string): Promise<ExecutionPolicy | null> {
		validateScope(userId, appId);
		return this.admitted(async () => this.toExecutionPolicy(await this.model.execution(userId, appId)));
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
			this.toExecutionPolicy(
				await this.model.replaceExecution(userId, appId, version, overrides, (current) => {
					if (!current.app.declared) {
						throw new AgentFailure('capability_undeclared');
					}
					const global = this.settings.resolve(current.settings, {});
					if (
						(overrides.maxModelRequests ?? 1) > global.hardLimits.maxModelRequests ||
						(overrides.maxActiveExecutionSeconds ?? 1) > global.hardLimits.maxActiveSeconds ||
						(overrides.toolTimeoutSeconds ?? 1) > global.hardLimits.toolTimeoutSeconds ||
						(overrides.maxToolOutputBytes ?? 1) > global.hardLimits.maxToolOutputBytes ||
						(overrides.maxRecallItems ?? 1) > global.hardLimits.maxRecallItems ||
						(overrides.maxRecallBytes ?? 1) > global.hardLimits.maxRecallBytes ||
						(overrides.maxSubagentMessages ?? 1) > global.hardLimits.maxMessages ||
						(overrides.maxSubagentMessageBytes ?? 1) > global.hardLimits.maxMessageBytes
					) {
						throw new AgentFailure('invalid_input');
					}
					return executionChangeDecision(current.version, version, current.overrides, overrides);
				}),
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

	async request(input: ApprovalRequest): Promise<Approval | null> {
		validateUserId(input.userId);
		for (const id of [input.appId, input.runId, input.toolCallId, input.id]) {
			validateAgentId(id);
		}
		if (!AGENT_APPROVAL_KINDS.includes(input.kind)) {
			throw new AgentFailure('invalid_input');
		}
		const saved = await this.admitted(() =>
			this.model.request(
				input,
				(policy, status, operation) => {
					if (
						input.kind !==
						(operation.inspection.toolName === 'acp_inner_permission' ? 'acp_permission' : 'tool')
					) {
						return null;
					}
					const connectionId = operation.inspection.targetConnectionId;
					if (
						!authorizationFact(policy, operation.capability, connectionId).allowed ||
						!mayRequestApproval(status, operation.inspection.risk)
					) {
						return null;
					}
					return createRequestedApproval(input, operation, policy.revision, now());
				},
				mayUseTool,
			),
		);
		if (saved !== null && saved.status === 'requested') {
			await this.events.publish({
				key: 'approval:' + saved.id,
				event: 'AGENT_APPROVAL_REQUIRED',
				userId: input.userId,
				subjectId: saved.id,
				sourceIp: null,
				route: null,
				statusCode: null,
			});
		}
		return saved;
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
					authorizationFact(policy, approval.capability, approval.inspection.targetConnectionId).allowed &&
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

	/** Internal executor only: a successful commit grants precisely one dispatch intent. */
	consume(input: ConsumeApproval): Promise<ToolOperation> {
		validateScope(input.userId, input.appId);
		validateAgentId(input.approvalId);
		if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(() => this.model.consume(input, Date.now, mayConsumeApproval, mayUseTool));
	}

	invalidate(userId: number, appId: string, runId: string): Promise<number> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.admitted(() => this.model.invalidate(userId, appId, runId, now, approvalTransition), true);
	}

	denylist(userId: number): Promise<TargetDenylist> {
		validateUserId(userId);
		return this.admitted(() => this.model.denylist());
	}

	replaceDenylist(input: DenylistCommand): Promise<TargetDenylist> {
		validateUserId(input.userId);
		if (
			!Number.isSafeInteger(input.expectedRevision) ||
			input.expectedRevision < 1 ||
			input.connectionIds.length > AGENT_DENYLIST_MAX_TARGETS ||
			input.connectionIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
			typeof input.reason !== 'string' ||
			!input.reason.trim() ||
			Buffer.byteLength(input.reason, 'utf8') > AGENT_DENYLIST_MAX_REASON_BYTES ||
			[...input.reason.trim()].length > AGENT_DENYLIST_MAX_REASON_CODE_POINTS
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.admitted(async () => {
			const targets: DenylistTarget[] = [];
			for (const id of [...new Set(input.connectionIds)].sort((a, b) => a - b)) {
				const target = await this.model.target(id);
				if (target === null) {
					throw new AgentFailure('not_found');
				}
				targets.push(target);
			}
			let committed: DenylistMutation;
			try {
				committed = await this.model.replaceDenylist(
					input.userId,
					input.expectedRevision,
					targets,
					input.reason.trim(),
					Date.now,
					(current) => ({
						revoke:
							current.entries.length !== targets.length ||
							current.entries.some((entry, index) => entry.connectionId !== targets[index]?.id),
					}),
				);
			} catch (error) {
				if (error instanceof AgentFailure && error.code === 'operation_unknown') {
					await this.revokeAfterCommit(error);
				}
				throw error;
			}
			if (committed.revokedRuns) {
				await this.revokeAfterCommit();
			}
			return committed.value;
		});
	}

	private async revokeAfterCommit(error?: unknown): Promise<void> {
		try {
			await this.revoke({ userId: null, appId: null, uncertain: error !== undefined });
		} catch (cleanupError) {
			throw new AgentFailure('operation_unknown', {
				cause:
					error === undefined
						? cleanupError
						: new AggregateError([error, cleanupError], 'Target policy mutation and revocation failed'),
			});
		}
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

	private toExecutionPolicy(facts: ExecutionPolicyFacts | null): ExecutionPolicy | null {
		if (facts === null) {
			return null;
		}
		if (!validOverrides(facts.overrides)) {
			throw new AgentFailure('internal_failure');
		}
		const value = this.settings.resolve(facts.settings, facts.overrides);
		return {
			version: facts.version,
			overrides: facts.overrides,
			effective: {
				maxModelRequests: value.limits.maxModelRequests,
				maxActiveExecutionSeconds: value.limits.maxActiveSeconds,
				toolTimeoutSeconds: value.limits.toolTimeoutSeconds,
				maxToolOutputBytes: value.limits.maxToolOutputBytes,
				maxRecallItems: value.limits.maxRecallItems,
				maxRecallBytes: value.limits.maxRecallBytes,
				maxSubagentMessages: value.limits.maxMessages,
				maxSubagentMessageBytes: value.limits.maxMessageBytes,
				contextCompactionMode: value.contextCompactionMode,
				contextProfile: value.contextProfile,
			},
		};
	}
}

function now(): number {
	return Math.floor(Date.now() / 1000);
}

function validateScope(userId: number, appId: string): void {
	validateUserId(userId);
	validateAgentId(appId);
}

function toGrantCatalog(state: GrantState | null): GrantCatalogState | null {
	return state === null
		? null
		: {
				appId: state.appId,
				userId: state.userId,
				revision: state.revision,
				grants: state.grants,
				definitions: capabilityDefinitions().filter(
					(definition) => state.app.declared && state.app.capabilities.includes(definition.id),
				),
			};
}

function createRequestedApproval(
	input: ApprovalRequest,
	operation: ApprovalOperation,
	policyRevision: number,
	requestedAt: number,
): Approval {
	return {
		capability: operation.capability,
		targetVersion: operation.targetVersion,
		id: input.id,
		userId: input.userId,
		appId: input.appId,
		runId: input.runId,
		toolCallId: input.toolCallId,
		operationHash: operation.operationHash,
		kind: input.kind,
		status: 'requested',
		policyRevision,
		inputRevision: operation.operationRevision,
		version: 1,
		requestedAt: requestedAt,
		expiresAt: requestedAt + AGENT_APPROVAL_TTL_SECONDS,
		decidedAt: null,
		decidedByUserId: null,
		consumedAt: null,
		feedback: null,
		inspection: {
			toolName: operation.inspection.toolName,
			toolVersion: operation.inspection.toolVersion,
			risk: operation.inspection.risk,
			mutation: operation.inspection.mutation,
			targetConnectionId: operation.inspection.targetConnectionId,
			summary: operation.inspection.summary,
		},
	};
}

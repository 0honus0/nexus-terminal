import type { ToolCatalogState } from '../model/governance-types.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';

import type { RevokeRuns } from '../../runs/model/run-types.js';

import {
	AGENT_DENYLIST_MAX_REASON_BYTES,
	AGENT_DENYLIST_MAX_REASON_CODE_POINTS,
} from '@nexus-terminal/shared/agent/governance/values';
import type { DenylistCommand, TargetDenylist, DenylistTarget, DenylistMutation } from '../model/governance-types.js';
import { AGENT_TARGET_CAPABILITIES, AGENT_CAPABILITIES } from '@nexus-terminal/shared/agent/governance/values';

import { validateAgentId, validateUserId } from '../../agent-validation.js';
import {
	capabilityDefinitions,
	authorizationFact,
	validOverrides,
	grantChangeDecision,
	executionChangeDecision,
	mayReplaceGrants,
} from '../governance-rules.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	GrantInput,
	GrantState,
	PolicyOverrides,
	ExecutionPolicy,
	ExecutionPolicyFacts,
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
		private readonly settings: ExecutionService,
	) {}

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

	toolCatalog(userId: number, appId: string, runId: string): Promise<ToolCatalogState | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.admitted(async () => {
			const facts = await this.model.toolCatalog(userId, appId, runId);
			if (facts === null) {
				return null;
			}
			const connectionIds = facts.connectionIds.filter((id) => !facts.policy.app.deniedTargetIds.includes(id));
			return {
				connectionIds,
				capabilities: AGENT_CAPABILITIES.filter((capability) =>
					AGENT_TARGET_CAPABILITIES.includes(capability)
						? connectionIds.some((id) => authorizationFact(facts.policy, capability, id).allowed)
						: authorizationFact(facts.policy, capability, null).allowed,
				),
			};
		});
	}

	/** A snapshot for actual capability admission, never supplied by a plugin. */
	assertInstanceCapabilities(userId: number, appId: string, capabilities: readonly AgentCapability[]): Promise<void> {
		validateScope(userId, appId);
		return this.admitted(async () => {
			const policy = await this.model.grants(userId, appId);
			if (!policy || capabilities.some((capability) => !authorizationFact(policy, capability, null).allowed)) {
				throw new AgentFailure('forbidden');
			}
		});
	}

	operationAuthority(
		userId: number,
		appId: string,
		runId: string,
	): Promise<import('../model/governance-types.js').ToolCatalogFacts | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.admitted(() => this.model.toolCatalog(userId, appId, runId));
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

	denylist(userId: number): Promise<TargetDenylist> {
		validateUserId(userId);
		return this.admitted(() => this.model.denylist());
	}

	replaceDenylist(input: DenylistCommand): Promise<TargetDenylist> {
		validateUserId(input.userId);
		if (
			!Number.isSafeInteger(input.expectedRevision) ||
			input.expectedRevision < 1 ||
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

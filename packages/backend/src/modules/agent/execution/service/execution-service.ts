import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { PolicyOverrides } from '../../governance/model/governance-types.js';
import { copyExecutionLimits } from '../model/execution-types.js';
import type { RevokeRuns } from '../../runs/model/run-types.js';
import type { ExecutionUsage } from '../model/execution-types.js';
import { randomUUID } from 'node:crypto';
import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_LIMIT_MAXIMA,
} from '@nexus-terminal/shared/agent/execution/values';

import { AgentFailure, ModelCapacityBusy } from '../../agent-failure.js';

import type { ExecutionModel } from '../model/execution-model.js';
import type {
	ExecutionSettings,
	ExecutionLimits,
	ExecutionActor,
	ExecutionFacts,
	HardLimitPreview,
} from '../model/execution-types.js';

export function defaultExecutionSettings(): ExecutionSettings {
	const limits: ExecutionLimits = {
		maxModelRequests: 80,
		maxToolExecutions: 400,
		maxActiveSeconds: 1800,
		toolTimeoutSeconds: 45,
		maxToolOutputBytes: 65536,
		maxTokenReservations: 2000000,
		maxConcurrentRuns: 4,
		maxConcurrentModelCalls: 2,
		maxChildren: 4,
		maxMessages: 256,
		maxMessageBytes: 524288,
		maxRecallItems: 5,
		maxRecallBytes: 8192,
		maxArtifactBytes: 536870912,
		artifactTtlSeconds: 604800,
	};
	const hardLimits: ExecutionLimits = {
		maxModelRequests: 400,
		maxToolExecutions: 4000,
		maxActiveSeconds: 7200,
		toolTimeoutSeconds: 300,
		maxToolOutputBytes: 262144,
		maxTokenReservations: 8000000,
		maxConcurrentRuns: 8,
		maxConcurrentModelCalls: 8,
		maxChildren: 4,
		maxMessages: 5000,
		maxMessageBytes: 8388608,
		maxRecallItems: 20,
		maxRecallBytes: 32768,
		maxArtifactBytes: 10737418240,
		artifactTtlSeconds: 2592000,
	};
	return {
		contextCompactionMode: 'balanced',
		contextProfile: 'normal',
		version: 0,
		enabled: false,
		limits,
		hardLimits,
		updatedAt: 0,
	};
}

function validateLimits(limits: ExecutionLimits, hard: ExecutionLimits): void {
	if (
		AGENT_EXECUTION_LIMIT_KEYS.some(
			(key) =>
				!Number.isSafeInteger(limits[key]) ||
				limits[key] < 1 ||
				limits[key] > AGENT_EXECUTION_LIMIT_MAXIMA[key] ||
				limits[key] > hard[key],
		)
	) {
		throw new AgentFailure('invalid_input');
	}
	if (
		limits.toolTimeoutSeconds > limits.maxActiveSeconds ||
		limits.maxConcurrentModelCalls > limits.maxConcurrentRuns
	) {
		throw new AgentFailure('invalid_input');
	}
}

function actor(value: ExecutionActor): void {
	if (value.userId !== 1 || !value.token) {
		throw new AgentFailure('forbidden');
	}
}

function admit(actor: ExecutionActor, facts: ExecutionFacts): void {
	if (facts.identityUserId === null) {
		throw new AgentFailure('unauthenticated');
	}
	if (facts.identityUserId !== actor.userId || actor.userId !== 1) {
		throw new AgentFailure('forbidden');
	}
}

export class ExecutionService {
	constructor(
		private readonly model: ExecutionModel,
		private readonly revoke: RevokeRuns,
	) {}

	admitTool(settings: ExecutionSettings, usage: ExecutionUsage): void {
		if (usage.toolExecutions >= settings.limits.maxToolExecutions) {
			throw new AgentFailure('limit_exceeded');
		}
	}

	admitReservation(settings: ExecutionSettings, usage: ExecutionUsage, tokens: number): void {
		if (!Number.isSafeInteger(tokens) || tokens < 1) {
			throw new AgentFailure('invalid_input');
		}
		if (
			usage.modelRequests >= settings.limits.maxModelRequests ||
			usage.reservedTokens + tokens > settings.limits.maxTokenReservations
		) {
			throw new AgentFailure('limit_exceeded');
		}
	}

	admitDispatch(settings: ExecutionSettings, usage: ExecutionUsage): void {
		if (usage.concurrentModelCalls >= settings.limits.maxConcurrentModelCalls) {
			throw new ModelCapacityBusy();
		}
	}

	private async mutate(actor: ExecutionActor, work: () => Promise<ExecutionSettings>): Promise<ExecutionSettings> {
		let saved: ExecutionSettings | null = null;
		let failure: unknown = null;
		try {
			saved = await work();
		} catch (error) {
			failure = error;
		}
		if (saved !== null || (failure instanceof AgentFailure && failure.code === 'operation_unknown')) {
			try {
				await this.revoke({ userId: actor.userId, appId: null, uncertain: failure !== null });
			} catch (revocation) {
				throw new AgentFailure('operation_unknown', {
					cause:
						failure === null
							? revocation
							: new AggregateError([failure, revocation], 'Execution settings and revocation failed'),
				});
			}
		}
		if (failure !== null) {
			throw failure;
		}
		if (saved === null) {
			throw new AgentFailure('internal_failure');
		}
		return saved;
	}

	async get(userId: number): Promise<ExecutionSettings> {
		if (userId !== 1) {
			throw new AgentFailure('forbidden');
		}
		return (await this.model.get(userId)) ?? defaultExecutionSettings();
	}

	async frozen(userId: number, appId: string, runId: string): Promise<ExecutionSettings> {
		const value = await this.model.frozen(userId, appId, runId);
		if (value === null) {
			throw new AgentFailure('not_found');
		}
		return value;
	}

	freeze(current: ExecutionSettings | null, overrides: PolicyOverrides): ExecutionSettings {
		const settings = this.resolve(current, overrides);
		if (!settings.enabled) {
			throw new AgentFailure('execution_disabled');
		}
		return settings;
	}

	resolve(current: ExecutionSettings | null, overrides: PolicyOverrides): ExecutionSettings {
		const original = current ?? defaultExecutionSettings();
		const settings: ExecutionSettings = {
			version: original.version,
			enabled: original.enabled,
			limits: copyExecutionLimits(original.limits),
			hardLimits: copyExecutionLimits(original.hardLimits),
			updatedAt: original.updatedAt,
			contextCompactionMode: overrides.contextCompactionMode ?? original.contextCompactionMode,
			contextProfile: overrides.contextProfile ?? original.contextProfile,
		};
		settings.limits.maxModelRequests = Math.min(
			settings.limits.maxModelRequests,
			overrides.maxModelRequests ?? settings.limits.maxModelRequests,
		);
		settings.limits.maxActiveSeconds = Math.min(
			settings.limits.maxActiveSeconds,
			overrides.maxActiveExecutionSeconds ?? settings.limits.maxActiveSeconds,
		);
		settings.limits.toolTimeoutSeconds = Math.min(
			settings.limits.toolTimeoutSeconds,
			overrides.toolTimeoutSeconds ?? settings.limits.toolTimeoutSeconds,
			settings.limits.maxActiveSeconds,
		);
		settings.limits.maxToolOutputBytes = Math.min(
			settings.limits.maxToolOutputBytes,
			overrides.maxToolOutputBytes ?? settings.limits.maxToolOutputBytes,
		);
		settings.limits.maxRecallItems = Math.min(
			settings.limits.maxRecallItems,
			overrides.maxRecallItems ?? settings.limits.maxRecallItems,
		);
		settings.limits.maxRecallBytes = Math.min(
			settings.limits.maxRecallBytes,
			overrides.maxRecallBytes ?? settings.limits.maxRecallBytes,
		);
		settings.limits.maxMessages = Math.min(
			settings.limits.maxMessages,
			overrides.maxSubagentMessages ?? settings.limits.maxMessages,
		);
		settings.limits.maxMessageBytes = Math.min(
			settings.limits.maxMessageBytes,
			overrides.maxSubagentMessageBytes ?? settings.limits.maxMessageBytes,
		);
		validateLimits(settings.limits, settings.hardLimits);

		return settings;
	}

	update(
		value: ExecutionActor,
		version: number,
		enabled: boolean,
		limits: ExecutionLimits,
	): Promise<ExecutionSettings> {
		actor(value);
		if (!Number.isSafeInteger(version) || version < 0) {
			throw new AgentFailure('invalid_input');
		}
		return this.mutate(value, () =>
			this.model.update(value, version, (facts) => {
				admit(value, facts);
				const current = facts.settings ?? defaultExecutionSettings();
				validateLimits(limits, current.hardLimits);

				return {
					contextCompactionMode: current.contextCompactionMode,
					contextProfile: current.contextProfile,
					version: current.version + 1,
					enabled,
					limits,
					hardLimits: current.hardLimits,

					updatedAt: Date.now(),
				};
			}),
		);
	}

	preview(value: ExecutionActor, version: number, proposed: ExecutionLimits): Promise<HardLimitPreview> {
		actor(value);
		validateLimits(proposed, AGENT_EXECUTION_LIMIT_MAXIMA);
		const id = randomUUID();
		return this.model.preview(value, id, Date.now, (facts, count, now) => {
			admit(value, facts);
			const current = facts.settings ?? defaultExecutionSettings();
			if (current.version !== version) {
				throw new AgentFailure('version_conflict');
			}
			if (count >= 128) {
				throw new AgentFailure('limit_exceeded');
			}
			this.validateHardLimits(current, proposed, facts);
			return {
				id,
				expectedVersion: version,
				expiresAt: now + 600000,
				proposed,
				occupiedArtifactBytes: facts.occupiedArtifactBytes,
				activeRuns: facts.activeRuns,
			};
		});
	}

	private validateHardLimits(current: ExecutionSettings, proposed: ExecutionLimits, facts: ExecutionFacts): void {
		validateLimits(current.limits, proposed);
		if (proposed.maxArtifactBytes < facts.occupiedArtifactBytes || proposed.maxConcurrentRuns < facts.activeRuns) {
			throw new AgentFailure('version_conflict');
		}
	}

	confirm(value: ExecutionActor, id: string): Promise<ExecutionSettings> {
		actor(value);
		if (!AGENT_ID_PATTERN.test(id)) {
			throw new AgentFailure('invalid_input');
		}
		return this.mutate(value, () =>
			this.model.confirm(value, id, Date.now, (facts, plan, now) => {
				admit(value, facts);
				const current = facts.settings ?? defaultExecutionSettings();
				this.validateHardLimits(current, plan.proposed, facts);
				return {
					contextCompactionMode: current.contextCompactionMode,
					contextProfile: current.contextProfile,
					version: current.version + 1,
					enabled: current.enabled,
					limits: current.limits,
					hardLimits: plan.proposed,

					updatedAt: now,
				};
			}),
		);
	}
}

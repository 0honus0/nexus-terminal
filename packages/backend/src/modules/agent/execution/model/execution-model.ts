import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ExecutionStorage, StoredHardLimitPreview, StoredExecutionFacts } from '../storage/execution-storage.js';
import { ExecutionStorageRefusal } from '../storage/execution-storage.js';
import type { ExecutionActor, ExecutionSettings, ExecutionFacts, HardLimitPreview } from './execution-types.js';
import { fromSettings, toSettings, fromLimits, toLimits } from './execution-projection.js';

function facts(value: StoredExecutionFacts): ExecutionFacts {
	return {
		identityUserId: value.identityUserId,
		settings: value.settings === null ? null : fromSettings(value.settings),
		occupiedArtifactBytes: value.occupiedArtifactBytes,
		activeRuns: value.activeRuns,
	};
}

function preview(value: StoredHardLimitPreview): HardLimitPreview {
	return {
		id: value.id,
		expectedVersion: value.expectedVersion,
		expiresAt: value.expiresAt,
		proposed: fromLimits(value.proposed),
		occupiedArtifactBytes: value.occupiedArtifactBytes,
		activeRuns: value.activeRuns,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof ExecutionStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

export class ExecutionModel {
	constructor(
		private readonly storage: ExecutionStorage,
		private readonly tokens: SessionTokens,
	) {}

	async frozen(userId: number, appId: string, runId: string): Promise<ExecutionSettings | null> {
		const value = await storage(() => this.storage.frozen(userId, appId, runId));
		return value === null ? null : fromSettings(value);
	}

	async get(userId: number): Promise<ExecutionSettings | null> {
		const value = await storage(() => this.storage.get(userId));
		return value === null ? null : fromSettings(value);
	}

	async update(
		actor: ExecutionActor,
		version: number,
		decide: (value: ExecutionFacts) => ExecutionSettings,
	): Promise<ExecutionSettings> {
		return fromSettings(
			await storage(() =>
				this.storage.update(
					{ userId: actor.userId, digest: this.tokens.digest(actor.token) },
					version,
					(value) => toSettings(decide(facts(value))),
				),
			),
		);
	}

	async preview(
		actor: ExecutionActor,
		id: string,
		clock: () => number,
		decide: (value: ExecutionFacts, confirmations: number, now: number) => HardLimitPreview,
	): Promise<HardLimitPreview> {
		return preview(
			await storage(() =>
				this.storage.preview(
					{ userId: actor.userId, digest: this.tokens.digest(actor.token) },
					id,
					clock,
					(value, count, now) => {
						const selected = decide(facts(value), count, now);
						return {
							id: selected.id,
							expectedVersion: selected.expectedVersion,
							expiresAt: selected.expiresAt,
							proposed: toLimits(selected.proposed),
							occupiedArtifactBytes: selected.occupiedArtifactBytes,
							activeRuns: selected.activeRuns,
						};
					},
				),
			),
		);
	}

	async confirm(
		actor: ExecutionActor,
		id: string,
		clock: () => number,
		decide: (value: ExecutionFacts, plan: HardLimitPreview, now: number) => ExecutionSettings,
	): Promise<ExecutionSettings> {
		return fromSettings(
			await storage(() =>
				this.storage.confirm(
					{ userId: actor.userId, digest: this.tokens.digest(actor.token) },
					id,
					clock,
					(value, plan, now) => toSettings(decide(facts(value), preview(plan), now)),
				),
			),
		);
	}
}

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HttpFailure } from '../../http/node/http-plugin-api.js';
import type { PluginLogApi } from '../../log/log-plugin-api.js';
import type { PluginStateApi, StatePublisherApi } from '../../state/node/state-plugin-api.js';
import {
	MarketplaceOperationsSchema,
	MarketplaceOperationsTopic,
	type MarketplaceOperation,
} from '../marketplace-types.js';

type MarketplaceOperationResult = NonNullable<MarketplaceOperation['error']> | null;

type ScheduleOperation = (execute: () => Promise<MarketplaceOperationResult>) => Promise<MarketplaceOperationResult>;

export interface MarketplaceOperationScope {
	commit(): void;
	step(step: NonNullable<MarketplaceOperation['step']>): void;
	completePackage(pluginId: string): void;
}

/** 内存中保留所有活动操作和最近完成的 100 项，供 HTTP 和状态 WS 查询。 */
export class MarketplaceOperations {
	readonly #operations = new Map<string, MarketplaceOperation>();
	readonly #observations = new Map<string, string>();
	readonly #finished = new Set<string>();
	readonly #log: PluginLogApi;
	readonly #signal: AbortSignal;
	readonly #publisher: StatePublisherApi<MarketplaceOperation[]>;
	readonly #schedule: ScheduleOperation;

	constructor(state: PluginStateApi, log: PluginLogApi, signal: AbortSignal, schedule: ScheduleOperation) {
		this.#log = log;
		this.#signal = signal;
		this.#schedule = schedule;
		this.#publisher = state.register({
			name: MarketplaceOperationsTopic.name,
			schema: MarketplaceOperationsSchema,
			initial: [],
		});
	}

	list(): MarketplaceOperation[] {
		return [...this.#operations.values()];
	}

	get(id: string): MarketplaceOperation | undefined {
		return this.#operations.get(id);
	}

	submit(
		change: MarketplaceOperation['change'],
		observationId: string | undefined,
		run: (scope: MarketplaceOperationScope) => Promise<MarketplaceOperationResult>,
	): MarketplaceOperation {
		const knownId = observationId === undefined ? undefined : this.#observations.get(observationId);
		if (knownId) {
			const known = this.#operations.get(knownId)!;
			if (!isDeepStrictEqual(known.change, change)) throw new HttpFailure(409, 'MARKETPLACE_OPERATION_CONFLICT');
			return known;
		}

		const operation: MarketplaceOperation = {
			id: randomUUID(),
			observationId,
			change,
			state: 'queued',
			createdAt: new Date().toISOString(),
			committed: false,
		};
		this.#operations.set(operation.id, operation);
		if (observationId !== undefined) this.#observations.set(observationId, operation.id);
		this.#publish();

		let current = operation;

		const update = (fields: Partial<MarketplaceOperation>) => {
			current = { ...current, ...fields };
			this.#operations.set(operation.id, current);
			this.#publish();
		};

		const execute = () => {
			update({ state: 'running' });
			return run({
				commit: () => update({ committed: true }),

				step: (step) => update({ step }),

				completePackage: (pluginId) =>
					update({ completedPackages: [...(current.completedPackages ?? []), pluginId] }),
			});
		};

		void this.#schedule(execute).then(
			(error) => this.#finish(current, error ?? undefined),
			() => this.#finish(current, 'MARKETPLACE_OPERATION_FAILED'),
		);
		return operation;
	}

	#finish(operation: MarketplaceOperation, error: MarketplaceOperation['error']): void {
		const finishedAt = new Date().toISOString();
		this.#operations.set(operation.id, { ...operation, state: error ? 'failed' : 'succeeded', finishedAt, error });
		this.#finished.add(operation.id);
		if (this.#finished.size > 100) {
			const oldest = this.#finished.values().next().value!;
			const observationId = this.#operations.get(oldest)?.observationId;
			this.#finished.delete(oldest);
			this.#operations.delete(oldest);
			if (observationId !== undefined) this.#observations.delete(observationId);
		}
		this.#publish();
	}

	#publish(): void {
		if (this.#signal.aborted) return;
		try {
			this.#publisher.publish(this.list());
		} catch {
			this.#log.report({ level: 'error', code: 'MARKETPLACE_STATE_PUBLISH_FAILED' });
		}
	}
}

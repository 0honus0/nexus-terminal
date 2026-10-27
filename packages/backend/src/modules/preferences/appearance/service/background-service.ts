import { randomUUID } from 'node:crypto';
import type { BackgroundKind } from '@nexus-terminal/shared/preferences/appearance/values';
import { AppearanceFailure, AppearanceResourceFailure } from '../../appearance-failure.js';
import type { AppearanceActor } from '../model/appearance-types.js';
import type {
	BackgroundUpload,
	BackgroundRecord,
	BackgroundMutation,
	BackgroundContent,
} from '../model/background-types.js';
import type { BackgroundModel } from '../model/background-model.js';
import { validateBackgroundUpload, admitBackgroundWrite, MAX_STORED_BACKGROUNDS } from '../background-rules.js';

export class BackgroundService {
	private accepting = true;
	private tail: Promise<unknown> = Promise.resolve();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly controllers = new Set<AbortController>();
	private readonly failures: unknown[] = [];
	private droppedFailures = 0;
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: BackgroundModel) {}

	private remember(error: unknown): void {
		if (error instanceof AppearanceResourceFailure) {
			this.quiesce();
		}
		if (this.failures.length < 32) {
			this.failures.push(error);
		} else {
			this.droppedFailures++;
		}
	}

	private async cleanup(): Promise<boolean> {
		const ids = await this.model.cleanupCandidates(MAX_STORED_BACKGROUNDS + 1);
		if (ids.length > MAX_STORED_BACKGROUNDS) {
			throw new AppearanceFailure('internal_failure');
		}
		let failed = false;
		for (const id of ids) {
			try {
				await this.model.cleanup(id);
			} catch (error) {
				this.remember(error);
				failed = true;
			}
		}
		return failed;
	}

	async initialize(): Promise<void> {
		await this.cleanup();
		if (!this.accepting) {
			throw new AggregateError(this.failures, 'Background startup resources remain unconfirmed');
		}
	}

	private run<T>(actor: AppearanceActor, signal: AbortSignal, work: (active: AbortSignal) => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new AppearanceFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new AppearanceFailure('unauthenticated'));
		}
		const controller = new AbortController();
		this.controllers.add(controller);
		const active = AbortSignal.any([signal, controller.signal]);
		const task = this.tail.then(async () => {
			if (!this.accepting || active.aborted) {
				throw new AppearanceFailure('unavailable');
			}
			return work(active);
		});
		this.pending.add(task);
		this.tail = task.then(
			() => undefined,
			() => undefined,
		);
		void task
			.catch((error) => {
				if (
					!(error instanceof AppearanceFailure) ||
					['storage_unavailable', 'operation_unknown', 'cleanup_failed', 'internal_failure'].includes(
						error.code,
					)
				) {
					this.remember(error);
				}
			})
			.finally(() => {
				this.pending.delete(task);
				this.controllers.delete(controller);
			});
		return task;
	}

	private admit(actor: AppearanceActor, userId: number | null, signal: AbortSignal): void {
		if (userId === null) {
			throw new AppearanceFailure('unauthenticated');
		}
		if (userId !== actor.userId) {
			throw new AppearanceFailure('forbidden');
		}
		if (!this.accepting || signal.aborted) {
			throw new AppearanceFailure('unavailable');
		}
	}

	upload(
		actor: AppearanceActor,
		loadInput: (signal: AbortSignal) => Promise<BackgroundUpload>,
		signal: AbortSignal,
	): Promise<BackgroundMutation> {
		return this.run(actor, signal, async (active) => {
			const input = await loadInput(active);
			validateBackgroundUpload(input);
			const inspection = await this.model.inspect(input.bytes);
			if (inspection.mediaType !== input.mediaType) {
				throw new AppearanceFailure('invalid_input');
			}
			await this.cleanup();
			this.admit(actor, actor.userId, active);
			const record: BackgroundRecord = {
				id: randomUUID(),
				userId: actor.userId,
				kind: input.kind,
				mediaType: input.mediaType,
				sizeBytes: inspection.sizeBytes,
				sha256: inspection.sha256,
			};
			await this.model.stage(
				actor,
				record,
				(userId) => this.admit(actor, userId, active),
				(facts) => admitBackgroundWrite(facts, input.expectedVersion, true),
			);
			await this.model.publish(record, input.bytes, active);
			const appearance = await this.model.activate(
				actor,
				record.id,
				input.expectedVersion,
				(userId) => this.admit(actor, userId, active),
				(facts) => admitBackgroundWrite(facts, input.expectedVersion, false),
			);
			let cleanupPending: boolean;
			try {
				cleanupPending = await this.cleanup();
			} catch (cause) {
				this.remember(cause);
				cleanupPending = true;
			}
			return { appearance, cleanupPending };
		});
	}

	remove(
		actor: AppearanceActor,
		kind: BackgroundKind,
		expectedVersion: number,
		signal: AbortSignal,
	): Promise<BackgroundMutation> {
		return this.run(actor, signal, async (active) => {
			const appearance = await this.model.clear(
				actor,
				kind,
				(userId) => this.admit(actor, userId, active),
				(facts) => admitBackgroundWrite(facts, expectedVersion, false),
			);
			let cleanupPending: boolean;
			try {
				cleanupPending = await this.cleanup();
			} catch (cause) {
				this.remember(cause);
				cleanupPending = true;
			}
			return { appearance, cleanupPending };
		});
	}

	read(
		actor: AppearanceActor,
		id: string,
		signal: AbortSignal,
		deliver: (content: BackgroundContent, signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		return this.run(actor, signal, async (active) => {
			const content = await this.model.content(actor, id, active);
			this.admit(actor, actor.userId, active);
			await deliver(content, active);
		});
	}

	quiesce(): void {
		this.accepting = false;
		for (const controller of this.controllers) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([...this.pending]);
				try {
					await this.cleanup();
				} catch (error) {
					this.remember(error);
				}
				if (this.failures.length || this.droppedFailures) {
					throw new AggregateError(
						this.failures,
						'Background shutdown failures; additional=' + this.droppedFailures,
					);
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}

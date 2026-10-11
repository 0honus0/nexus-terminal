import type { AccessPublicApi } from '../../../access/public.js';
import type { SystemStatusModel } from '../model/status-model.js';
import { SystemStatusFailure, type LocalSystemStatus } from '../model/status-types.js';

export class SystemStatusService {
	private accepting = true;
	private readonly tasks = new Set<Promise<LocalSystemStatus>>();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: SystemStatusModel,
	) {}

	collect(token: string | null): Promise<LocalSystemStatus> {
		if (!this.accepting) {
			throw new SystemStatusFailure('remote_unavailable');
		}
		if (this.tasks.size >= 4) {
			throw new SystemStatusFailure('remote_unavailable');
		}
		const task = Promise.resolve().then(async () => {
			const identity = await this.access.authenticate(token);
			if (!identity) {
				throw new SystemStatusFailure('unauthenticated');
			}
			if (identity.userId !== 1) {
				throw new SystemStatusFailure('forbidden');
			}
			if (!this.accepting) {
				throw new SystemStatusFailure('remote_unavailable');
			}
			const value = await this.model.collect();
			const current = await this.access.authenticate(token);
			if (!this.accepting || current?.userId !== identity.userId) {
				throw new SystemStatusFailure('unauthenticated');
			}
			return value;
		});
		this.tasks.add(task);
		void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
		return this.waitForTask(task, 10000);
	}

	private waitForTask<T>(task: Promise<T>, milliseconds: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new SystemStatusFailure('remote_unavailable')), milliseconds);
			timer.unref();
			// The source task remains tracked after the caller's confirmation deadline.
			void task.then(resolve, reject).finally(() => clearTimeout(timer));
		});
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.accepting = false;
		this.closePromise = Promise.resolve().then(async () => {
			await this.waitForTask(Promise.allSettled([...this.tasks]), 30000);
		});
		return this.closePromise;
	}
}

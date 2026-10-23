import type { AccessPublicApi } from '../../../access/public.js';
import type { DiagnosticModel } from '../model/diagnostic-model.js';
import type { HostDiagnostic } from '../model/diagnostic-types.js';
import { SystemStatusFailure, isSystemDrainFailure } from '../../system-failure.js';

export class DiagnosticService {
	private accepting = true;
	private readonly tasks = new Set<Promise<HostDiagnostic>>();
	private closePromise: Promise<void> | null = null;
	private reading: Promise<HostDiagnostic> | null = null;
	private cached: { value: HostDiagnostic; expiresAt: number } | null = null;

	getPendingRequestCount(): number {
		return this.tasks.size;
	}

	private track(action: () => Promise<HostDiagnostic>): Promise<HostDiagnostic> {
		if (!this.accepting) {
			return Promise.reject(new SystemStatusFailure('remote_unavailable'));
		}
		const task = Promise.resolve().then(action);
		this.tasks.add(task);
		void task.then(
			() => this.tasks.delete(task),
			() => this.tasks.delete(task),
		);
		return task;
	}

	quiesce(): void {
		this.accepting = false;
		this.cached = null;
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			const admitted = [...this.tasks];
			this.closePromise = Promise.allSettled(admitted).then((results) => {
				const failures = results.flatMap((result) =>
					result.status === 'rejected' && isSystemDrainFailure(result.reason) ? [result.reason] : [],
				);
				if (failures.length) {
					throw new AggregateError(failures, 'Host diagnostics failed during shutdown');
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}

	constructor(
		private readonly model: DiagnosticModel,
		private readonly access: AccessPublicApi,
	) {}

	collect(): Promise<HostDiagnostic> {
		return this.track(() => this.collectSnapshot());
	}

	private collectSnapshot(): Promise<HostDiagnostic> {
		if (this.cached && this.cached.expiresAt > Date.now()) {
			return Promise.resolve(this.cached.value);
		}
		if (this.reading) {
			return this.reading;
		}
		const reading = this.model.collect();
		this.reading = reading;
		void reading.then(
			(value) => {
				if (this.reading === reading) {
					this.reading = null;
					if (this.accepting) {
						this.cached = { value, expiresAt: Date.now() + 1000 };
					}
				}
			},
			() => {
				if (this.reading === reading) {
					this.reading = null;
				}
			},
		);
		return reading;
	}

	collectAuthenticated(token: string | null): Promise<HostDiagnostic> {
		return this.track(() => this.authenticated(token));
	}

	private async authenticated(token: string | null): Promise<HostDiagnostic> {
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
		const value = await this.collectSnapshot();
		const current = await this.access.authenticate(token);
		if (!this.accepting || !current || current.userId !== identity.userId) {
			throw new SystemStatusFailure('unauthenticated');
		}
		return value;
	}
}

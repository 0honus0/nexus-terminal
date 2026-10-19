import type { AccessPublicApi } from '../../../access/public.js';
import type { DiagnosticModel } from '../model/diagnostic-model.js';
import type { HostDiagnostic } from '../model/diagnostic-types.js';
import { SystemStatusFailure, isSystemDrainFailure } from '../../system-failure.js';

export class DiagnosticService {
	private accepting = true;
	private readonly tasks = new Set<Promise<HostDiagnostic>>();
	private closePromise: Promise<void> | null = null;

	private track(action: () => Promise<HostDiagnostic>): Promise<HostDiagnostic> {
		if (!this.accepting || this.tasks.size >= 4) {
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
		return this.track(() => this.model.collect());
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
		const value = await this.model.collect();
		const current = await this.access.authenticate(token);
		if (!this.accepting || !current || current.userId !== identity.userId) {
			throw new SystemStatusFailure('unauthenticated');
		}
		return value;
	}
}

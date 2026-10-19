import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import type { AuditNotice } from '../model/audit-types.js';
import type { AuditService } from './audit-service.js';
import type { LoggingService } from '../../logging/service/logging-service.js';
import type { NotificationService } from '../../notifications/service/notification-service.js';
import { OperationsFailure } from '../../operations-failure.js';

/** Own publication, HTTP observation and final module drainage without holding protocol objects. */
export class AuditEventOwner {
	private acceptingRequests = true;
	private stopping = false;
	private readonly requests = new Set<Promise<void>>();
	private readonly tasks = new Set<Promise<void>>();
	private readonly failures = new FailureSummary();
	private readonly recordedFailures = new WeakSet<Error>();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly audit: AuditService,
		private readonly logging: LoggingService,
		private readonly notifications: NotificationService,
	) {}

	async initialize(mode: 'startup' | 'restore'): Promise<void> {
		await this.logging.initialize();
		await this.notifications.initialize(mode);
		await this.audit.prune();
	}

	private track(work: () => Promise<void>, tasks: Set<Promise<void>>): Promise<void> {
		const pending = Promise.resolve().then(work);
		tasks.add(pending);
		void pending.then(
			() => tasks.delete(pending),
			(error) => {
				tasks.delete(pending);
				this.recordFailure(error);
			},
		);
		return pending;
	}

	private recordFailure(error: unknown): void {
		if (error instanceof Error) {
			if (this.recordedFailures.has(error)) {
				return;
			}
			this.recordedFailures.add(error);
		}
		this.failures.record(error);
	}

	run(work: () => Promise<void>): Promise<void> {
		if (!this.acceptingRequests || this.requests.size >= 64) {
			return Promise.reject(new OperationsFailure('shutting_down'));
		}
		return this.track(work, this.requests);
	}

	publish(notice: AuditNotice): Promise<void> {
		if (this.stopping || this.tasks.size >= 256) {
			return Promise.reject(new OperationsFailure(this.stopping ? 'shutting_down' : 'limit_exceeded'));
		}
		return this.track(async () => {
			const saved = await this.audit.append({
				key: notice.key,
				event: notice.event,
				createdAt: Date.now(),
				userId: notice.userId,
				subjectId: notice.subjectId,
				sourceIp: notice.sourceIp,
				route: notice.route,
				statusCode: notice.statusCode,
			});
			const results = await Promise.allSettled([
				Promise.resolve().then(() => this.logging.record(saved.record.event, saved.record.id)),
				Promise.resolve().then(() => this.notifications.fanout()),
			]);
			const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			try {
				await this.audit.prune();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length) {
				throw new AggregateError(errors, 'Operation observers failed');
			}
		}, this.tasks);
	}

	quiesce(): void {
		this.acceptingRequests = false;
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			this.closePromise = Promise.resolve().then(async () => {
				while (this.requests.size || this.tasks.size) {
					await Promise.allSettled([...this.requests, ...this.tasks]);
				}
				this.stopping = true;
				try {
					await this.notifications.close();
				} catch (error) {
					this.recordFailure(error);
				}
				const errors = this.failures.errors();
				if (errors.length) {
					throw new AggregateError(errors, 'Operations events failed');
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}

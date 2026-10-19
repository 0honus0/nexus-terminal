import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ConnectionTestModel } from '../model/connection-test-model.js';
import type { ConnectionTestCommand, ConnectionTestResult } from '../model/connection-test-types.js';
import { ConnectionTestFailure } from '../../connection-test-failure.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';

export class ConnectionTestService {
	private closing = false;
	private cleanupBlocked = false;
	private readonly tasks = new Map<AbortController, Promise<unknown>>();
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: ConnectionTestModel,
		private readonly access: AccessPublicApi,
	) {}

	test(token: string | null, command: ConnectionTestCommand, signal: AbortSignal): Promise<ConnectionTestResult> {
		if (this.closing || this.cleanupBlocked || this.tasks.size >= 8) {
			return Promise.reject(
				new ConnectionTestFailure(
					this.closing ? 'shutting_down' : this.cleanupBlocked ? 'cleanup_failed' : 'limit_exceeded',
				),
			);
		}
		if (command.kind === 'stored' && (!Number.isSafeInteger(command.targetId) || command.targetId < 1)) {
			return Promise.reject(new ConnectionTestFailure('invalid_input'));
		}
		const controller = new AbortController();

		const cancel = () => controller.abort();

		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) {
			cancel();
		}
		const timer = setTimeout(cancel, 15_000);
		const deadline = Date.now() + 15_000;

		const validate = async () => {
			controller.signal.throwIfAborted();
			const actor = await this.access.authenticate(token).catch((cause: unknown) => {
				throw new ConnectionTestFailure(
					cause instanceof AccessOperationError && cause.code === 'storage_unavailable'
						? 'storage_unavailable'
						: 'internal_failure',
					{ cause },
				);
			});
			controller.signal.throwIfAborted();
			if (!actor || actor.userId !== 1) {
				throw new ConnectionTestFailure(actor ? 'forbidden' : 'unauthenticated');
			}
		};

		const task = Promise.resolve()
			.then(() =>
				this.model.test(command, {
					signal: controller.signal,
					timeoutMs: Math.max(1, deadline - Date.now()),
					validate,
				}),
			)
			.catch((cause: unknown) => {
				if (cause instanceof ConnectionTestFailure) {
					if (cause.code === 'cleanup_failed') {
						this.cleanupBlocked = true;
						this.failures.record(cause);
					}
					throw cause;
				}
				throw new ConnectionTestFailure(
					cause instanceof AccessOperationError
						? 'storage_unavailable'
						: controller.signal.aborted
							? 'unavailable'
							: 'internal_failure',
					{ cause },
				);
			})
			.finally(() => {
				clearTimeout(timer);
				signal.removeEventListener('abort', cancel);
				this.tasks.delete(controller);
			});
		this.tasks.set(controller, task);
		return task;
	}

	quiesce(): void {
		this.closing = true;
		for (const controller of this.tasks.keys()) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(async () => {
			await Promise.allSettled([...this.tasks.values()]);
			try {
				await this.model.close();
			} catch (cause) {
				this.failures.record(cause);
			}
			const failures = this.failures.errors();
			if (failures.length) {
				throw new AggregateError(failures, 'SSH tests did not drain');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}

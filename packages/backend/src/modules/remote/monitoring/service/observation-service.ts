import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import type { MachineMutationService } from '../../machines/service/mutation-service.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import type { ObservationErrorCode } from '@nexus-terminal/shared/remote/monitoring/values';
import {
	SETTINGS_MONITORING_MIN_SECONDS,
	SETTINGS_MONITORING_MAX_SECONDS,
} from '@nexus-terminal/shared/preferences/configuration/values';
import { randomUUID } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { WorkspaceService } from '../../sessions/service/workspace-service.js';
import { WorkspaceFailure } from '../../sessions/model/workspace-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { ObservationModel } from '../model/observation-model.js';
import {
	ObservationFailure,
	type ObservationScope,
	type ObservationTarget,
	type ObservationSample,
	type WorkspaceObservationOwner,
	type ObservationStatusEvent,
	type ObservedDockerStatus,
	type ObservedDockerStats,
	type ObservationDockerAction,
} from '../model/observation-types.js';

interface ObservationTaskPolicy {
	mutation: boolean;
	waitForCleanup?: boolean;
}

/** All ordinary monitoring operations share admission, deadlines and actual task ownership. */
export class RemoteObservationService {
	private readonly tasks = new Map<AbortController, Promise<unknown>>();
	private readonly subscriptions = new Set<() => void>();
	private readonly reschedules = new Set<() => void>();
	private readonly failures = new FailureSummary();
	private readonly cleanups = new Set<Promise<void>>();
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly workspaces: WorkspaceService,
		private readonly model: ObservationModel,
		private readonly mutationClaims: MachineMutationService,
		private intervalSeconds = 3,
	) {
		if (
			!Number.isSafeInteger(intervalSeconds) ||
			intervalSeconds < SETTINGS_MONITORING_MIN_SECONDS ||
			intervalSeconds > SETTINGS_MONITORING_MAX_SECONDS
		) {
			throw new Error('Invalid monitoring interval');
		}
	}

	getSubscriptionCount(): number {
		return this.subscriptions.size;
	}

	prepareStatusInterval(seconds: number): () => void {
		if (
			!Number.isSafeInteger(seconds) ||
			seconds < SETTINGS_MONITORING_MIN_SECONDS ||
			seconds > SETTINGS_MONITORING_MAX_SECONDS
		) {
			throw new Error('Invalid monitoring interval');
		}
		return () => {
			if (seconds !== this.intervalSeconds) {
				this.intervalSeconds = seconds;
				for (const reschedule of this.reschedules) {
					reschedule();
				}
			}
		};
	}

	private run<T>(
		signal: AbortSignal,
		policy: ObservationTaskPolicy,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (!this.accepting) {
			throw new ObservationFailure('remote_unavailable');
		}
		const controller = new AbortController();

		const abort = () =>
			controller.abort(new ObservationFailure(policy.mutation ? 'operation_unknown' : 'remote_unavailable'));

		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
		}
		const timer = setTimeout(abort, 45000);
		timer.unref();
		let cleanupFailed = false;
		const task = Promise.resolve()
			.then(() => operation(controller.signal))
			.catch((error) => {
				if (error instanceof RemoteResourceCleanupFailure) {
					cleanupFailed = true;
					this.failures.record(error);
				}
				throw error;
			})
			.finally(() => {
				clearTimeout(timer);
				signal.removeEventListener('abort', abort);
				if (!cleanupFailed) {
					this.tasks.delete(controller);
				}
			});
		this.tasks.set(controller, task);
		if (policy.waitForCleanup) {
			return task;
		}
		return new Promise<T>((resolve, reject) => {
			const cancelled = () => reject(controller.signal.reason);

			controller.signal.addEventListener('abort', cancelled, { once: true });
			if (controller.signal.aborted) {
				cancelled();
			}
			void task.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', cancelled));
		});
	}

	private async identity(token: string | null): Promise<number> {
		const identity = await this.access.authenticate(token);
		if (!identity) {
			throw new ObservationFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new ObservationFailure('forbidden');
		}
		return identity.userId;
	}

	private async validate(scope: ObservationScope): Promise<void> {
		await scope.validate();
		if ((await this.resolver.fingerprintStored(scope.targetId)) !== scope.fingerprint) {
			throw new ObservationFailure('conflict');
		}
		scope.signal.throwIfAborted();
	}

	private workspace<T>(
		owner: WorkspaceObservationOwner,
		signal: AbortSignal,
		policy: ObservationTaskPolicy,
		operation: (scope: ObservationScope) => Promise<T>,
	): Promise<T> {
		return this.run(signal, policy, (signal) =>
			this.workspaces.runMachineTask(
				owner.token,
				owner.workspaceId,
				owner.attachmentId,
				async (workspace) => {
					const scope: ObservationScope = {
						targetId: workspace.targetId,
						fingerprint: workspace.fingerprint,
						signal: workspace.signal,

						validate: () => this.validate(workspace),
					};
					try {
						return await operation(scope);
					} catch (error) {
						if (error instanceof WorkspaceFailure) {
							throw new ObservationFailure(error.code, { cause: error });
						}
						throw error;
					}
				},
				signal,
			),
		);
	}

	startStatus(
		owner: WorkspaceObservationOwner,
		listener: (event: ObservationStatusEvent) => void,
		signal: AbortSignal,
	): () => void {
		if (!this.accepting) {
			throw new ObservationFailure('remote_unavailable');
		}
		const controller = new AbortController();
		const key = randomUUID();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let current: Promise<unknown> = Promise.resolve();
		let stopped = false;

		const stop = () => {
			if (stopped) {
				return;
			}
			stopped = true;
			controller.abort();
			if (timer) {
				clearTimeout(timer);
			}
			signal.removeEventListener('abort', stop);
			this.subscriptions.delete(stop);
			this.reschedules.delete(reschedule);
			// A late sampler can still update its own baseline; discard it only after settlement.
			const cleanup = current
				.catch(() => undefined)
				.then(() => this.model.clear(key))
				.catch((error) => this.failures.record(error))
				.finally(() => this.cleanups.delete(cleanup));
			this.cleanups.add(cleanup);
		};

		const fetch = (bootstrap: boolean) => {
			if (stopped) {
				return;
			}
			current = Promise.resolve()
				.then(() =>
					this.workspace(
						owner,
						controller.signal,
						{ mutation: false, waitForCleanup: true },
						async (scope) => {
							const value = await this.model.collect(scope, key, bootstrap);
							await this.validate(scope);
							if (!stopped) {
								listener({ kind: 'sample', value });
							}
						},
					),
				)
				.catch((error) => {
					if (!stopped) {
						let code: ObservationErrorCode = 'remote_unavailable';
						if (error instanceof ObservationFailure) {
							code = error.code;
						} else if (error instanceof RemoteResourceCleanupFailure) {
							code = 'operation_unknown';
							stop();
						}
						listener({ kind: 'error', code });
					}
				})
				.finally(() => {
					if (!stopped) {
						schedule();
					}
				});
			void current.catch(() => stop());
		};

		const schedule = () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				timer = null;
				fetch(false);
			}, this.intervalSeconds * 1000);
			timer.unref();
		};

		const reschedule = () => {
			if (!stopped && timer !== null) {
				schedule();
			}
		};

		this.subscriptions.add(stop);
		this.reschedules.add(reschedule);
		signal.addEventListener('abort', stop, { once: true });
		if (signal.aborted) {
			stop();
		} else {
			fetch(true);
		}
		return stop;
	}

	getDocker(owner: WorkspaceObservationOwner, signal: AbortSignal): Promise<ObservedDockerStatus> {
		return this.workspace(owner, signal, { mutation: false }, (scope) => this.model.getDocker(scope));
	}

	getDockerStats(
		owner: WorkspaceObservationOwner,
		id: string,
		signal: AbortSignal,
	): Promise<ObservedDockerStats | null> {
		return this.workspace(owner, signal, { mutation: false }, (scope) => this.model.getDockerStats(scope, id));
	}

	commandDocker(
		owner: WorkspaceObservationOwner,
		id: string,
		action: ObservationDockerAction,
		signal: AbortSignal,
	): Promise<void> {
		return this.workspace(owner, signal, { mutation: true }, async (scope) => {
			await this.validate(scope);
			try {
				await this.mutationClaims.run(
					randomUUID(),
					'docker',
					[{ targetId: scope.targetId, fingerprint: scope.fingerprint }],
					() => this.model.commandDocker(scope, id, action),
				);
			} catch (error) {
				if (error instanceof RemoteFileFailure) {
					throw new ObservationFailure(
						error.code === 'conflict'
							? 'conflict'
							: error.code === 'operation_unknown'
								? 'operation_unknown'
								: 'remote_unavailable',
						{ cause: error },
					);
				}
				throw error;
			}
		});
	}

	collectTarget(
		token: string | null,
		target: ObservationTarget,
		key: string,
		signal: AbortSignal,
	): Promise<ObservationSample> {
		return this.run(signal, { mutation: false, waitForCleanup: true }, async (signal) => {
			const userId = await this.identity(token);
			const fingerprint = target.fingerprint;
			if (fingerprint === null) {
				throw new ObservationFailure('remote_unavailable');
			}
			const scope: ObservationScope = {
				targetId: target.id,
				fingerprint,
				signal,

				validate: async () => {
					if (!this.accepting || signal.aborted || (await this.identity(token)) !== userId) {
						throw new ObservationFailure('unauthenticated');
					}
					if ((await this.resolver.fingerprintStored(target.id)) !== fingerprint) {
						throw new ObservationFailure('conflict');
					}
					signal.throwIfAborted();
				},
			};
			let failure: unknown = null;
			try {
				return await this.model.collect(scope, key, true);
			} catch (error) {
				failure = error;
				throw error;
			} finally {
				try {
					this.model.clear(key);
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
				}
			}
		});
	}

	quiesce(): void {
		this.accepting = false;
		for (const stop of [...this.subscriptions]) {
			stop();
		}
		for (const controller of this.tasks.keys()) {
			controller.abort(new ObservationFailure('remote_unavailable'));
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.accepting = false;
		this.closePromise = Promise.resolve().then(async () => {
			this.quiesce();
			await Promise.allSettled([...this.tasks.values()]);
			await Promise.allSettled([...this.cleanups]);
			const failures = this.failures.errors();
			if (failures.length) {
				throw new RemoteResourceCleanupFailure(failures);
			}
		});
		return this.closePromise;
	}
}

import { AGENT_REGISTRY_MAX_MODEL_ID_BYTES } from '@nexus-terminal/shared/agent/providers/values';
import { buildRegistrySnapshot, recoverRegistryState, resolveRegistryDefaults } from '../registry-rules.js';
import type { CapabilityRegistryState } from '../model/registry-types.js';
import type { RegistryStatus, RegistryResolution } from '../model/registry-types.js';
import { RegistryRefreshFailure } from '../model/registry-types.js';
import { AgentFailure, isAgentDrainFailure } from '../../../agent-failure.js';
import { validateUserId } from '../../../agent-validation.js';
import type { CapabilityRegistryModel } from '../model/registry-model.js';

function waitForDrain(promise: Promise<RegistryStatus>, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal?.removeEventListener('abort', abort);
			reject(new AgentFailure('provider_request_failed'));
		};

		const drained = () => {
			signal?.removeEventListener('abort', abort);
			resolve();
		};

		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener('abort', abort, { once: true });
		void promise.then(drained, drained);
	});
}

export class CapabilityRegistryService {
	/** One network refresh, independent cancellation for each HTTP subscriber. */
	private refreshing: {
		promise: Promise<RegistryStatus>;
		controller: AbortController;
		waiters: number;
	} | null = null;

	private closing = false;
	private closePromise: Promise<void> | null = null;
	private cleanupFailure: RegistryRefreshFailure | null = null;
	private unexpectedFailure: { cause: unknown } | null = null;

	constructor(private readonly model: CapabilityRegistryModel) {}

	quiesce(): void {
		this.closing = true;
		this.refreshing?.controller.abort();
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		const pending = this.refreshing?.promise;
		this.closePromise = Promise.resolve().then(async () => {
			if (pending) {
				await Promise.allSettled([pending]);
			}
			// A durable failure can already aggregate the original cleanup failure.
			if (this.unexpectedFailure !== null) {
				throw this.unexpectedFailure.cause;
			}
			if (this.cleanupFailure) {
				throw this.cleanupFailure;
			}
		});
		this.quiesce();
		return this.closePromise;
	}

	private async loadState(): Promise<CapabilityRegistryState> {
		return recoverRegistryState(await this.model.load());
	}

	async status(userId: number): Promise<RegistryStatus> {
		validateUserId(userId);
		return this.model.status(await this.loadState());
	}

	async resolve(userId: number, modelId: string): Promise<RegistryResolution> {
		validateUserId(userId);
		if (
			typeof modelId !== 'string' ||
			!modelId.trim() ||
			Buffer.byteLength(modelId, 'utf8') > AGENT_REGISTRY_MAX_MODEL_ID_BYTES
		) {
			throw new AgentFailure('invalid_input');
		}
		return { modelId, defaults: resolveRegistryDefaults(await this.loadState(), modelId) };
	}

	refresh(userId: number, outerSignal?: AbortSignal): Promise<RegistryStatus> {
		validateUserId(userId);
		if (this.closing || this.cleanupFailure || this.unexpectedFailure !== null) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		if (outerSignal?.aborted) {
			return Promise.reject(new AgentFailure('provider_request_failed'));
		}
		if (this.refreshing?.controller.signal.aborted) {
			// Drain canceled writes before replacing the flight, so old failure state cannot overwrite a new success.
			return waitForDrain(this.refreshing.promise, outerSignal).then(() => this.refresh(userId, outerSignal));
		}
		if (!this.refreshing) {
			const controller = new AbortController();
			const flight = { controller, waiters: 0, promise: this.performRefresh(controller.signal) };
			this.refreshing = flight;

			const clear = () => {
				if (this.refreshing === flight) {
					this.refreshing = null;
				}
			};

			// Observe both outcomes without creating an unhandled rejecting finally-chain.
			void flight.promise.then(clear, (error: unknown) => {
				// The last subscriber may already have left when a durable write fails.
				if (isAgentDrainFailure(error)) {
					this.unexpectedFailure = { cause: error };
				}
				clear();
			});
		}
		const flight = this.refreshing;
		flight.waiters += 1;
		return new Promise<RegistryStatus>((resolve, reject) => {
			let settled = false;

			const finish = (): boolean => {
				if (settled) {
					return false;
				}
				settled = true;
				outerSignal?.removeEventListener('abort', abort);
				flight.waiters -= 1;
				if (flight.waiters === 0) {
					flight.controller.abort();
				}
				return true;
			};

			const abort = () => {
				if (finish()) {
					reject(new AgentFailure('provider_request_failed'));
				}
			};

			outerSignal?.addEventListener('abort', abort, { once: true });
			flight.promise.then(
				(result) => {
					if (finish()) {
						resolve(result);
					}
				},
				(error: unknown) => {
					if (finish()) {
						reject(error);
					}
				},
			);
		});
	}

	private async performRefresh(outerSignal?: AbortSignal): Promise<RegistryStatus> {
		const controller = new AbortController();

		const abort = () => controller.abort();

		if (outerSignal?.aborted) {
			abort();
		} else {
			outerSignal?.addEventListener('abort', abort, { once: true });
		}
		const deadline = setTimeout(abort, 15_000);
		try {
			const previous = await this.loadState();
			if (controller.signal.aborted) {
				throw new AgentFailure('provider_request_failed');
			}
			const attempted = { ...previous, lastAttemptAt: Date.now() };
			await this.model.save(attempted);
			if (controller.signal.aborted) {
				throw new AgentFailure('provider_request_failed');
			}
			let updated;
			try {
				updated = await this.model.fetch(previous.snapshot?.sourceRevision ?? null, controller.signal);
				if (controller.signal.aborted) {
					throw new RegistryRefreshFailure('MODEL_REGISTRY_NETWORK');
				}
				const snapshot =
					updated.status === 'not-modified'
						? previous.snapshot
						: buildRegistrySnapshot(updated.items, updated.sourceRevision, Date.now());
				if (!snapshot) {
					throw new RegistryRefreshFailure('MODEL_REGISTRY_RESPONSE_INVALID');
				}
				const success = { ...attempted, snapshot, lastSuccessAt: Date.now(), lastErrorCode: null };
				if (controller.signal.aborted) {
					throw new RegistryRefreshFailure('MODEL_REGISTRY_NETWORK');
				}
				await this.model.save(success);
				return this.model.status(success);
			} catch (error) {
				// Storage write/read failures propagate unmodified to the public boundary.
				if (error instanceof RegistryRefreshFailure) {
					if (error.errorCode === 'MODEL_REGISTRY_CLEANUP_FAILED') {
						this.cleanupFailure = error;
					}
					try {
						await this.model.save({
							...attempted,
							lastErrorCode: error.errorCode,
						});
					} catch (storageError) {
						throw new AggregateError(
							[error, storageError],
							'Registry refresh and failure recording failed',
						);
					}
					throw new AgentFailure('provider_request_failed', { cause: error });
				}
				throw error;
			}
		} finally {
			clearTimeout(deadline);
			outerSignal?.removeEventListener('abort', abort);
		}
	}
}

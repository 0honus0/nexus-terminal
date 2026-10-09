import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { ClockPort } from '../agent.types';
import type { ModelCapabilityDefaults } from './model.types';
import { resolveModelCapabilityDefaults } from './model-capability-resolver';
import {
	MODEL_REGISTRY_MANUAL_REFRESH_TIMEOUT_MS,
	MODEL_REGISTRY_SOURCE_URL,
	MODEL_REGISTRY_STARTUP_TIMEOUT_MS,
} from './model-capability-registry-source';
import {
	installRuntimeModelCapabilityRegistry,
	modelCapabilityRegistryRuntimeStatus,
} from './model-capability-registry-runtime';
import type {
	ModelCapabilityRegistryPersistedState,
	ModelCapabilityRegistrySourcePort,
	ModelCapabilityRegistryStorePort,
} from './model-capability-registry.port';

export interface ModelCapabilityRegistryStatus {
	sourceUrl: string;
	activeSource: 'remote' | 'unavailable';
	entryCount: number;
	generatedAt: number | null;
	sourceRevision: string | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: string | null;
}

const defaultState = (): ModelCapabilityRegistryPersistedState => ({
	schemaVersion: 2,
	snapshot: null,
	lastAttemptAt: null,
	lastSuccessAt: null,
	lastErrorCode: null,
});

export class ModelCapabilityRegistryService {
	private state = defaultState();
	private initialized = false;
	private refreshPromise: Promise<ModelCapabilityRegistryStatus> | null = null;
	private mutationTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly store: ModelCapabilityRegistryStorePort,
		private readonly source: ModelCapabilityRegistrySourcePort,
		private readonly clock: ClockPort,
	) {}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		try {
			this.state = (await this.store.load()) ?? defaultState();
		} catch (error) {
			this.state = defaultState();
			logger.warn(
				{ errorCode: logErrorCode(error, 'MODEL_REGISTRY_CACHE_LOAD_FAILED') },
				'Agent model capability registry cache load failed',
			);
		}
		installRuntimeModelCapabilityRegistry(this.state.snapshot);
		try {
			await this.refreshWithTimeout(MODEL_REGISTRY_STARTUP_TIMEOUT_MS);
		} catch {
			// The refresh path records the failure and keeps the last remote snapshot available.
		}
	}

	dispose(): void {
		this.initialized = false;
	}

	resolve(modelId: string): ModelCapabilityDefaults | null {
		return resolveModelCapabilityDefaults(modelId);
	}

	status(): ModelCapabilityRegistryStatus {
		const runtime = modelCapabilityRegistryRuntimeStatus();
		return {
			sourceUrl: MODEL_REGISTRY_SOURCE_URL,
			activeSource: runtime ? 'remote' : 'unavailable',
			entryCount: runtime?.entryCount ?? 0,
			generatedAt: runtime?.generatedAt ?? null,
			sourceRevision: runtime?.sourceRevision ?? null,
			lastAttemptAt: this.state.lastAttemptAt,
			lastSuccessAt: this.state.lastSuccessAt,
			lastErrorCode: this.state.lastErrorCode,
		};
	}

	refresh(): Promise<ModelCapabilityRegistryStatus> {
		return this.refreshWithTimeout(MODEL_REGISTRY_MANUAL_REFRESH_TIMEOUT_MS);
	}

	private refreshWithTimeout(timeoutMs: number): Promise<ModelCapabilityRegistryStatus> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = this.enqueueMutation(() => this.refreshInternal(timeoutMs)).finally(() => {
			this.refreshPromise = null;
		});
		return this.refreshPromise;
	}

	private enqueueMutation<T>(action: () => Promise<T>): Promise<T> {
		const result = this.mutationTail.then(action);
		this.mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async refreshInternal(timeoutMs: number): Promise<ModelCapabilityRegistryStatus> {
		const startedAt = this.clock.nowUnixSeconds();
		this.state = { ...this.state, lastAttemptAt: startedAt };
		await this.store.save(this.state);
		logger.debug(
			{ sourceRevision: this.state.snapshot?.sourceRevision ?? null },
			'Agent model capability registry update started',
		);
		try {
			const result = await this.source.fetch(this.state.snapshot?.sourceRevision ?? null, timeoutMs);
			const completedAt = this.clock.nowUnixSeconds();
			if (result.state === 'updated') {
				this.state = {
					...this.state,
					snapshot: result.snapshot,
					lastSuccessAt: completedAt,
					lastErrorCode: null,
				};
				installRuntimeModelCapabilityRegistry(result.snapshot);
			} else {
				this.state = { ...this.state, lastSuccessAt: completedAt, lastErrorCode: null };
			}
			await this.store.save(this.state);
			const status = this.status();
			logger.info(
				{
					changed: result.state === 'updated',
					activeSource: status.activeSource,
					entryCount: status.entryCount,
					generatedAt: status.generatedAt,
					sourceRevision: status.sourceRevision,
				},
				'Agent model capability registry update completed',
			);
			return status;
		} catch (error) {
			const stableErrorCode = logErrorCode(error, 'MODEL_REGISTRY_UPDATE_FAILED');
			this.state = { ...this.state, lastErrorCode: stableErrorCode };
			try {
				await this.store.save(this.state);
			} catch (saveError) {
				logger.error(
					{ errorCode: logErrorCode(saveError, 'MODEL_REGISTRY_CACHE_SAVE_FAILED') },
					'Agent model capability registry failure state save failed',
				);
			}
			logger.warn({ errorCode: stableErrorCode }, 'Agent model capability registry update failed');
			throw new Error(stableErrorCode);
		}
	}
}

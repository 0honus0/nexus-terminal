import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { ClockPort } from '../agent.types';
import type { ModelCapabilityDefaults } from './model.types';
import { resolveModelCapabilityDefaults } from './model-capability-resolver';
import {
  MODEL_REGISTRY_AUTO_UPDATE_INTERVAL_SECONDS,
  MODEL_REGISTRY_SOURCE_URL,
} from './model-capability-registry-source';
import {
  installRuntimeModelCapabilityRegistry,
  modelCapabilityRegistryBuiltinStatus,
  modelCapabilityRegistryRuntimeStatus,
} from './model-capability-registry-runtime';
import type {
  ModelCapabilityRegistryPersistedState,
  ModelCapabilityRegistrySourcePort,
  ModelCapabilityRegistryStorePort,
} from './model-capability-registry.port';

export interface ModelCapabilityRegistryStatus {
  sourceUrl: string;
  autoUpdate: boolean;
  activeSource: 'builtin' | 'updated';
  entryCount: number;
  generatedAt: number;
  sourceRevision: string | null;
  builtinGeneratedAt: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  nextAutoUpdateAt: number | null;
}

const defaultState = (): ModelCapabilityRegistryPersistedState => ({
  schemaVersion: 1,
  autoUpdate: true,
  snapshot: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorCode: null,
});

export class ModelCapabilityRegistryService {
  private state = defaultState();
  private initialized = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<ModelCapabilityRegistryStatus> | null = null;

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
    this.timer = setInterval(() => {
      void this.refreshIfDue();
    }, MODEL_REGISTRY_AUTO_UPDATE_INTERVAL_SECONDS * 1000);
    this.timer.unref?.();
    void this.refreshIfDue();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.initialized = false;
  }

  resolve(modelId: string): ModelCapabilityDefaults | null {
    return resolveModelCapabilityDefaults(modelId);
  }

  status(): ModelCapabilityRegistryStatus {
    const builtin = modelCapabilityRegistryBuiltinStatus();
    const runtime = modelCapabilityRegistryRuntimeStatus();
    const active = runtime ?? builtin;
    const dueFrom = this.state.lastSuccessAt ?? active.generatedAt;
    return {
      sourceUrl: MODEL_REGISTRY_SOURCE_URL,
      autoUpdate: this.state.autoUpdate,
      activeSource: runtime ? 'updated' : 'builtin',
      entryCount: active.entryCount,
      generatedAt: active.generatedAt,
      sourceRevision: active.sourceRevision,
      builtinGeneratedAt: builtin.generatedAt,
      lastAttemptAt: this.state.lastAttemptAt,
      lastSuccessAt: this.state.lastSuccessAt,
      lastErrorCode: this.state.lastErrorCode,
      nextAutoUpdateAt: this.state.autoUpdate ? dueFrom + MODEL_REGISTRY_AUTO_UPDATE_INTERVAL_SECONDS : null,
    };
  }

  async setAutoUpdate(enabled: boolean): Promise<ModelCapabilityRegistryStatus> {
    this.state = { ...this.state, autoUpdate: enabled };
    await this.store.save(this.state);
    logger.info({ enabled }, 'Agent model capability registry auto update changed');
    if (enabled) void this.refreshIfDue();
    return this.status();
  }

  refresh(): Promise<ModelCapabilityRegistryStatus> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshInternal().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshIfDue(): Promise<void> {
    if (!this.state.autoUpdate) return;
    const now = this.clock.nowUnixSeconds();
    const active = modelCapabilityRegistryRuntimeStatus() ?? modelCapabilityRegistryBuiltinStatus();
    const lastSuccess = this.state.lastSuccessAt ?? active.generatedAt;
    if (now - lastSuccess < MODEL_REGISTRY_AUTO_UPDATE_INTERVAL_SECONDS) return;
    try {
      await this.refresh();
    } catch {
      // refreshInternal records a stable error and preserves the last usable snapshot.
    }
  }

  private async refreshInternal(): Promise<ModelCapabilityRegistryStatus> {
    const startedAt = this.clock.nowUnixSeconds();
    this.state = { ...this.state, lastAttemptAt: startedAt };
    await this.store.save(this.state);
    logger.debug(
      { sourceRevision: this.state.snapshot?.sourceRevision ?? null },
      'Agent model capability registry update started',
    );
    try {
      const result = await this.source.fetch(this.state.snapshot?.sourceRevision ?? null);
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

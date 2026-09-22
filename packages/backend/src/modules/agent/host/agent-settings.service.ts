import { randomUUID } from 'node:crypto';
import { logErrorCode, logger } from '../../../shared/logging/logger';
import {
  createDefaultAgentSettings,
  normalizeRequestedSettings,
  validateSettings,
  type AgentSettingsDocument,
} from '../agent-defaults';
import type { ClockPort } from '../agent.types';
import type { AgentSettingsRecord, AgentSettingsRepositoryPort } from './agent-settings.repository.port';
import type { HardLimitConfirmationRepositoryPort } from './hard-limit-confirmation.repository.port';
import type { HardLimitUsagePort, HardLimitUsageSnapshot } from './hard-limit-usage.port';

export interface AgentSettingsView {
  requestedSettings: AgentSettingsDocument;
  effectiveSettings: AgentSettingsDocument;
  hardLimits: AgentSettingsDocument['hardLimits'];
  revision: number;
}

export interface HardLimitChange {
  key: keyof AgentSettingsDocument['hardLimits'];
  current: number | null;
  proposed: number | null;
  direction: 'increase' | 'decrease';
}

export interface HardLimitPreview {
  confirmationId: string;
  expectedVersion: number;
  current: AgentSettingsDocument['hardLimits'];
  proposed: AgentSettingsDocument['hardLimits'];
  impact: {
    changes: HardLimitChange[];
    hasIncrease: boolean;
    hasDecrease: boolean;
    usage: HardLimitUsageSnapshot;
  };
  expiresAt: number;
}

const patchableSections = [
  'feature',
  'model',
  'performance',
  'budget',
  'subagents',
  'storage',
  'workspaceRuntime',
  'browser',
  'plugins',
] as const;

const HARD_LIMIT_CONFIRMATION_TTL_SECONDS = 10 * 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const settingsPatch = (rawPatch: unknown, current: AgentSettingsDocument): AgentSettingsDocument => {
  if (!isRecord(rawPatch)) throw new Error('VALIDATION_FAILED');
  const allowedSections = new Set<string>(patchableSections);
  for (const key of Object.keys(rawPatch)) {
    if (!allowedSections.has(key)) throw new Error('VALIDATION_FAILED');
  }

  const next = structuredClone(current);
  for (const sectionName of patchableSections) {
    const candidate = rawPatch[sectionName];
    if (candidate === undefined) continue;
    if (!isRecord(candidate)) throw new Error('VALIDATION_FAILED');

    const currentSection = current[sectionName] as Record<string, unknown>;
    const allowedKeys = new Set(Object.keys(currentSection));
    for (const key of Object.keys(candidate)) {
      if (!allowedKeys.has(key)) throw new Error('VALIDATION_FAILED');
    }
    (next[sectionName] as Record<string, unknown>) = { ...currentSection, ...candidate };
  }
  return next;
};

const hardLimitDirection = (current: number | null, proposed: number | null): 'increase' | 'decrease' | null => {
  if (current === proposed) return null;
  if (current === null) return 'decrease';
  if (proposed === null) return 'increase';
  return proposed > current ? 'increase' : 'decrease';
};

const parseHardLimits = (
  raw: unknown,
  current: AgentSettingsDocument['hardLimits'],
): AgentSettingsDocument['hardLimits'] => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set(Object.keys(current));
  const proposed = structuredClone(current);
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) throw new Error('VALIDATION_FAILED');
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('VALIDATION_FAILED');
    (proposed as unknown as Record<string, number>)[key] = value as number;
  }
  if (proposed.maxSingleArtifactBytes > proposed.maxArtifactBytes) throw new Error('HARD_LIMIT_RELATION_INVALID');
  if (proposed.maxArtifactBytes > proposed.maxGlobalArtifactBytes) throw new Error('HARD_LIMIT_RELATION_INVALID');
  return proposed;
};

const changedHardLimits = (
  current: AgentSettingsDocument['hardLimits'],
  proposed: AgentSettingsDocument['hardLimits'],
): HardLimitChange[] => {
  const changes: HardLimitChange[] = [];
  for (const key of Object.keys(current) as Array<keyof AgentSettingsDocument['hardLimits']>) {
    const from = current[key];
    const to = proposed[key];
    const direction = hardLimitDirection(from, to);
    if (direction) changes.push({ key, current: from, proposed: to, direction });
  }
  return changes;
};

export class AgentSettingsService {
  constructor(
    private readonly repository: AgentSettingsRepositoryPort,
    private readonly confirmations: HardLimitConfirmationRepositoryPort,
    private readonly usage: HardLimitUsagePort,
    private readonly clock: ClockPort,
  ) {}

  async get(userId: number): Promise<AgentSettingsView> {
    const record = await this.ensureDefault(userId);
    return this.toView(record);
  }

  async patch(userId: number, rawPatch: unknown, expectedRevision: number): Promise<AgentSettingsView> {
    const current = await this.ensureDefault(userId);
    if (current.revision !== expectedRevision) throw new Error('SETTINGS_VERSION_CONFLICT');
    const patch = settingsPatch(rawPatch, current.settings);
    const settings = normalizeRequestedSettings(patch);
    const patchedSections = isRecord(rawPatch)
      ? patchableSections.filter((section) => Object.prototype.hasOwnProperty.call(rawPatch, section))
      : [];
    try {
      const record = await this.repository.compareAndSet(
        userId,
        expectedRevision,
        settings,
        this.clock.nowUnixSeconds(),
      );
      logger.info(
        { userId, expectedRevision, revision: record.revision, patchedSections },
        'Agent settings patch committed',
      );
      return this.toView(record);
    } catch (error) {
      logger.error(
        { userId, expectedRevision, patchedSections, errorCode: logErrorCode(error, 'AGENT_SETTINGS_COMMIT_FAILED') },
        'Agent settings patch commit failed',
      );
      throw error;
    }
  }

  async previewHardLimits(userId: number, raw: unknown, expectedRevision: number): Promise<HardLimitPreview> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('VALIDATION_FAILED');
    const current = await this.ensureDefault(userId);
    if (current.revision !== expectedRevision) throw new Error('SETTINGS_VERSION_CONFLICT');
    const proposed = parseHardLimits(raw, current.settings.hardLimits);
    const changes = changedHardLimits(current.settings.hardLimits, proposed);
    if (changes.length === 0) throw new Error('HARD_LIMIT_NO_CHANGES');
    const usage = await this.usage.read(userId);
    if (proposed.maxGlobalArtifactBytes < usage.artifactUsedBytes + usage.artifactReservedBytes) {
      throw new Error('HARD_LIMIT_BELOW_USAGE');
    }

    const now = this.clock.nowUnixSeconds();
    const preview: HardLimitPreview = {
      confirmationId: randomUUID(),
      expectedVersion: current.revision,
      current: structuredClone(current.settings.hardLimits),
      proposed,
      impact: {
        changes,
        hasIncrease: changes.some((change) => change.direction === 'increase'),
        hasDecrease: changes.some((change) => change.direction === 'decrease'),
        usage,
      },
      expiresAt: now + HARD_LIMIT_CONFIRMATION_TTL_SECONDS,
    };
    try {
      await this.confirmations.deleteExpired(now);
      await this.confirmations.save({
        id: preview.confirmationId,
        userId,
        expectedRevision: current.revision,
        proposed,
        createdAt: now,
        expiresAt: preview.expiresAt,
      });
    } catch (error) {
      logger.error(
        {
          userId,
          confirmationId: preview.confirmationId,
          expectedRevision: current.revision,
          errorCode: logErrorCode(error, 'AGENT_HARD_LIMIT_PREVIEW_PERSIST_FAILED'),
        },
        'Agent hard-limit preview persistence failed',
      );
      throw error;
    }
    logger.info(
      {
        userId,
        confirmationId: preview.confirmationId,
        expectedRevision: current.revision,
        changeCount: changes.length,
        hasIncrease: preview.impact.hasIncrease,
        hasDecrease: preview.impact.hasDecrease,
        expiresAt: preview.expiresAt,
      },
      'Agent hard-limit change preview created',
    );
    return preview;
  }

  async confirmHardLimits(
    userId: number,
    confirmationId: string,
    expectedRevision: number,
  ): Promise<AgentSettingsView> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || confirmationId.length < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const now = this.clock.nowUnixSeconds();
    const confirmation = await this.confirmations.get(userId, confirmationId);
    if (!confirmation) throw new Error('HARD_LIMIT_CONFIRMATION_NOT_FOUND');
    if (confirmation.expiresAt <= now) {
      await this.confirmations.delete(userId, confirmationId);
      throw new Error('HARD_LIMIT_CONFIRMATION_EXPIRED');
    }
    if (confirmation.expectedRevision !== expectedRevision) throw new Error('SETTINGS_VERSION_CONFLICT');
    const current = await this.ensureDefault(userId);
    if (current.revision !== expectedRevision) throw new Error('SETTINGS_VERSION_CONFLICT');
    const proposed = parseHardLimits(confirmation.proposed, current.settings.hardLimits);
    const usage = await this.usage.read(userId);
    if (proposed.maxGlobalArtifactBytes < usage.artifactUsedBytes + usage.artifactReservedBytes) {
      throw new Error('HARD_LIMIT_BELOW_USAGE');
    }
    const requested = normalizeRequestedSettings({ ...current.settings, hardLimits: proposed });
    let record: AgentSettingsRecord;
    try {
      record = await this.repository.compareAndSet(userId, expectedRevision, requested, now);
    } catch (error) {
      logger.error(
        {
          userId,
          confirmationId,
          expectedRevision,
          errorCode: logErrorCode(error, 'AGENT_HARD_LIMIT_COMMIT_FAILED'),
        },
        'Agent hard-limit change commit failed',
      );
      throw error;
    }
    try {
      await this.confirmations.delete(userId, confirmationId);
    } catch (error) {
      logger.error(
        {
          userId,
          confirmationId,
          expectedRevision,
          revision: record.revision,
          errorCode: logErrorCode(error, 'AGENT_HARD_LIMIT_CONFIRMATION_CLEANUP_FAILED'),
        },
        'Agent hard-limit confirmation cleanup failed after commit',
      );
      throw error;
    }
    logger.info(
      { userId, confirmationId, expectedRevision, revision: record.revision },
      'Agent hard-limit change committed',
    );
    return this.toView(record);
  }

  private async ensureDefault(userId: number): Promise<AgentSettingsRecord> {
    const current = await this.repository.get(userId);
    if (current) return { ...current, settings: normalizeRequestedSettings(current.settings) };

    const record: AgentSettingsRecord = {
      userId,
      settings: createDefaultAgentSettings(),
      revision: 1,
      updatedAt: this.clock.nowUnixSeconds(),
    };
    await this.repository.insertDefault(record);
    const inserted = await this.repository.get(userId);
    if (!inserted) throw new Error('Agent settings disappeared after initialization.');
    logger.info({ userId, revision: inserted.revision }, 'Agent settings defaults initialized');
    return { ...inserted, settings: normalizeRequestedSettings(inserted.settings) };
  }

  private toView(record: AgentSettingsRecord): AgentSettingsView {
    const effective = validateSettings(record.settings);
    return {
      requestedSettings: record.settings,
      effectiveSettings: effective,
      hardLimits: effective.hardLimits,
      revision: record.revision,
    };
  }
}

import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import type {
  AppIntentArtifactAccessPort,
  AppIntentArtifactReadRange,
  AppIntentArtifactView,
} from './app-intent-artifact.port';
import type { AppIntentReceipt, AppIntentRepositoryPort } from './app-intent.repository.port';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';

const RECEIPT_TTL_SECONDS = 10 * 60;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_ARTIFACTS = 16;
const MAX_RECEIPTS = 100;
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'password',
  'passphrase',
  'secret',
  'secretref',
  'token',
  'accesstoken',
  'refreshtoken',
  'sshhandle',
  'sshsession',
  'sessioncookie',
  'privatehistory',
  'hiddencontext',
  'chainofthought',
]);

export interface AppIntentArtifactRef {
  appId: string;
  id: string;
}

export interface CreateAppIntentInput {
  receiverAppId: string;
  intentId: string;
  input: JsonValue;
  artifactRefs: AppIntentArtifactRef[];
  confirmed: true;
}

const inspectPayload = (value: JsonValue, depth = 0): void => {
  if (depth > 32) throw new Error('APP_INTENT_PAYLOAD_INVALID');
  if (Array.isArray(value)) {
    for (const item of value) inspectPayload(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEYS.has(normalized)) throw new Error('APP_INTENT_SENSITIVE_FIELD_DENIED');
    inspectPayload(child, depth + 1);
  }
};

export class AppIntentService {
  constructor(
    private readonly repository: AppIntentRepositoryPort,
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly grants: AppGrantRepositoryPort,
    private readonly artifacts: AppIntentArtifactAccessPort,
    private readonly clock: ClockPort,
  ) {}

  async createConfirmed(scope: Scope, input: CreateAppIntentInput): Promise<AppIntentReceipt> {
    const now = this.clock.nowUnixSeconds();
    await this.repository.purgeExpired(now, 100).catch(() => undefined);
    if (input.confirmed !== true) throw new Error('APP_INTENT_CONFIRMATION_REQUIRED');
    if (scope.appId === input.receiverAppId) throw new Error('APP_INTENT_SELF_TRANSFER_DENIED');
    if (!input.receiverAppId || Buffer.byteLength(input.receiverAppId, 'utf8') > 256) {
      throw new Error('APP_INTENT_INVALID');
    }
    if (!input.intentId || Buffer.byteLength(input.intentId, 'utf8') > 256) throw new Error('APP_INTENT_INVALID');
    if (!Array.isArray(input.artifactRefs) || input.artifactRefs.length > MAX_ARTIFACTS) {
      throw new Error('APP_INTENT_INVALID');
    }

    inspectPayload(input.input);
    if (Buffer.byteLength(JSON.stringify(input.input), 'utf8') > MAX_INPUT_BYTES) {
      throw new Error('APP_INTENT_PAYLOAD_TOO_LARGE');
    }

    const [sender, receiver] = await Promise.all([
      this.requireActive(scope),
      this.requireActive({ userId: scope.userId, appId: input.receiverAppId }),
    ]);
    const senderDefinition = this.registry.get(scope.appId, sender.activeVersion);
    const receiverDefinition = this.registry.get(input.receiverAppId, receiver.activeVersion);
    const receiverIntent = receiverDefinition.manifest.intents.find((intent) => intent.id === input.intentId);
    if (!receiverIntent) throw new Error('APP_INTENT_UNDECLARED');

    const artifactIds: string[] = [];
    const seen = new Set<string>();
    for (const ref of input.artifactRefs) {
      if (
        !ref ||
        ref.appId !== scope.appId ||
        typeof ref.id !== 'string' ||
        ref.id.length < 1 ||
        Buffer.byteLength(ref.id, 'utf8') > 256 ||
        seen.has(ref.id)
      ) {
        throw new Error('APP_INTENT_ARTIFACT_REF_INVALID');
      }
      seen.add(ref.id);
      artifactIds.push(ref.id);
    }

    if (artifactIds.length > 0) {
      if (!senderDefinition.manifest.capabilities.includes('artifacts.read')) {
        throw new Error('APP_INTENT_SENDER_GRANT_DENIED');
      }
      if (!receiverDefinition.manifest.capabilities.includes('artifacts.read')) {
        throw new Error('APP_INTENT_RECEIVER_GRANT_DENIED');
      }
      const [senderGrants, receiverGrants] = await Promise.all([
        this.grants.list(scope),
        this.grants.list({ userId: scope.userId, appId: input.receiverAppId }),
      ]);
      if (!senderGrants.some((grant) => grant.capability === 'artifacts.read')) {
        throw new Error('APP_INTENT_SENDER_GRANT_DENIED');
      }
      if (!receiverGrants.some((grant) => grant.capability === 'artifacts.read')) {
        throw new Error('APP_INTENT_RECEIVER_GRANT_DENIED');
      }
    } else {
      await Promise.all([
        this.grants.list(scope),
        this.grants.list({ userId: scope.userId, appId: input.receiverAppId }),
      ]);
    }

    return this.repository.createConfirmed({
      id: randomUUID(),
      userId: scope.userId,
      senderAppId: scope.appId,
      receiverAppId: input.receiverAppId,
      intentId: input.intentId,
      schemaVersion: receiverIntent.schemaVersion,
      input: input.input,
      artifactIds,
      createdAt: now,
      expiresAt: now + RECEIPT_TTL_SECONDS,
      revokedAt: null,
    });
  }

  async listReceived(scope: Scope, limit = 50): Promise<AppIntentReceipt[]> {
    await this.requireActive(scope);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECEIPTS) throw new Error('APP_INTENT_INVALID');
    const now = this.clock.nowUnixSeconds();
    await this.repository.purgeExpired(now, 100).catch(() => undefined);
    return this.repository.listReceived(scope.userId, scope.appId, now, limit);
  }

  async revoke(scope: Scope, receiptId: string): Promise<void> {
    if (!receiptId || Buffer.byteLength(receiptId, 'utf8') > 128) throw new Error('APP_INTENT_INVALID');
    if (!(await this.repository.revoke(scope.userId, receiptId, scope.appId, this.clock.nowUnixSeconds()))) {
      throw new Error('APP_INTENT_NOT_FOUND');
    }
  }

  async getReceivedArtifact(scope: Scope, receiptId: string, artifactId: string): Promise<AppIntentArtifactView> {
    const receipt = await this.requireReceivedArtifact(scope, receiptId, artifactId);
    const artifact = await this.artifacts.getOwned(scope.userId, receipt.senderAppId, artifactId);
    if (!artifact) throw new Error('APP_INTENT_ARTIFACT_NOT_FOUND');
    return artifact;
  }

  async readReceivedArtifact(
    scope: Scope,
    receiptId: string,
    artifactId: string,
    range: AppIntentArtifactReadRange,
  ): Promise<{ artifact: AppIntentArtifactView; source: AsyncIterable<Uint8Array> }> {
    const artifact = await this.getReceivedArtifact(scope, receiptId, artifactId);
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.endInclusive) ||
      range.start < 0 ||
      range.endInclusive < range.start ||
      range.endInclusive >= artifact.sizeBytes
    ) {
      throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
    }
    const receipt = await this.repository.get(scope.userId, receiptId);
    if (!receipt) throw new Error('APP_INTENT_NOT_FOUND');
    return {
      artifact,
      source: this.artifacts.readOwned(scope.userId, receipt.senderAppId, artifactId, range),
    };
  }

  hasActiveArtifactGrant(scope: Scope, artifactId: string): Promise<boolean> {
    return this.repository.hasActiveArtifactGrant(scope.userId, scope.appId, artifactId, this.clock.nowUnixSeconds());
  }

  private async requireReceivedArtifact(
    scope: Scope,
    receiptId: string,
    artifactId: string,
  ): Promise<AppIntentReceipt> {
    if (
      !receiptId ||
      Buffer.byteLength(receiptId, 'utf8') > 128 ||
      !artifactId ||
      Buffer.byteLength(artifactId, 'utf8') > 256
    ) {
      throw new Error('APP_INTENT_INVALID');
    }

    const state = await this.requireActive(scope);
    const definition = this.registry.get(scope.appId, state.activeVersion);
    if (!definition.manifest.capabilities.includes('artifacts.read')) {
      throw new Error('APP_INTENT_RECEIVER_GRANT_DENIED');
    }
    const currentGrants = await this.grants.list(scope);
    if (!currentGrants.some((grant) => grant.capability === 'artifacts.read')) {
      throw new Error('APP_INTENT_RECEIVER_GRANT_DENIED');
    }

    const now = this.clock.nowUnixSeconds();
    const receipt = await this.repository.get(scope.userId, receiptId);
    if (
      !receipt ||
      receipt.receiverAppId !== scope.appId ||
      receipt.revokedAt !== null ||
      receipt.expiresAt <= now ||
      !receipt.artifactIds.includes(artifactId)
    ) {
      throw new Error('APP_INTENT_NOT_FOUND');
    }
    const activeIntent = definition.manifest.intents.find((intent) => intent.id === receipt.intentId);
    if (!activeIntent || activeIntent.schemaVersion !== receipt.schemaVersion) {
      throw new Error('APP_INTENT_SCHEMA_MISMATCH');
    }
    if (!(await this.repository.hasActiveArtifactGrant(scope.userId, scope.appId, artifactId, now))) {
      throw new Error('APP_INTENT_NOT_FOUND');
    }
    return receipt;
  }

  private async requireActive(scope: Scope) {
    const state = await this.states.get(scope);
    if (
      !state ||
      state.desiredState !== 'enabled' ||
      !['running', 'degraded'].includes(state.observedState) ||
      !this.registry.has(scope.appId, state.activeVersion)
    ) {
      throw new Error('APP_INTENT_APP_UNAVAILABLE');
    }
    const definition = this.registry.get(scope.appId, state.activeVersion);
    if (definition.availableForScope && !(await definition.availableForScope(scope))) {
      throw new Error('APP_INTENT_APP_UNAVAILABLE');
    }
    return state;
  }
}

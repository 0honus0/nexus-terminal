import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ClockPort } from '../../packages/backend/src/modules/agent/agent.types';
import type { LanguageModelPort } from '../../packages/backend/src/modules/agent/ai/language-model.port';
import type {
  PersistedProviderView,
  ProviderModelCapabilityObservation,
} from '../../packages/backend/src/modules/agent/ai/model.types';
import type {
  ProviderCreateRecord,
  ProviderRepositoryPort,
  ProviderUpdateRecord,
} from '../../packages/backend/src/modules/agent/ai/provider.repository.port';
import { ProviderService } from '../../packages/backend/src/modules/agent/ai/provider.service';

const clock: ClockPort = {
  nowUnixSeconds: () => 1_800_000_000,
  nowUnixMilliseconds: () => 1_800_000_000_000,
};

let persisted: PersistedProviderView | null = null;
const repository: ProviderRepositoryPort = {
  get: async (_userId, providerId) => (persisted?.id === providerId ? persisted : null),
  list: async () => (persisted ? [persisted] : []),
  create: async (record: ProviderCreateRecord) => {
    persisted = {
      ...record,
      hasCredential: record.credential !== undefined,
      credentialRevision: record.credential === undefined ? 0 : 1,
      liveCapabilities: [],
      version: 1,
    };
    return persisted;
  },
  update: async (_userId: number, _providerId: string, _expectedVersion: number, record: ProviderUpdateRecord) => {
    assert(persisted);
    persisted = {
      ...persisted,
      ...record,
      hasCredential: record.clearCredential ? false : persisted.hasCredential || record.credential !== undefined,
      credentialRevision:
        persisted.credentialRevision + (record.credential !== undefined || record.clearCredential ? 1 : 0),
      liveCapabilities: record.resetLiveCapabilities ? [] : persisted.liveCapabilities,
      version: persisted.version + 1,
    };
    return persisted;
  },
  replaceLiveCapabilities: async (
    _userId: number,
    _providerId: string,
    observations: ProviderModelCapabilityObservation[],
  ) => {
    assert(persisted);
    persisted = { ...persisted, liveCapabilities: observations };
  },
  remove: async () => {
    persisted = null;
  },
};

const languageModel = {} as LanguageModelPort;

async function providerNotificationFailureDoesNotReverseCreate(): Promise<void> {
  const service = new ProviderService(repository, languageModel, clock, async () => {
    throw new Error('health refresh unavailable');
  });

  const created = await service.create(7, {
    kind: 'openai-compatible',
    displayName: 'Regression Provider',
    baseUrl: 'https://provider.invalid/v1',
    protocol: 'chat-completions',
    models: [
      {
        id: 'regression-model',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        supportsTools: true,
      },
    ],
    enabled: true,
  });

  assert.equal(created.displayName, 'Regression Provider');
  assert.equal(created.version, 1);
  assert(persisted, 'provider must remain durably created when post-commit health notification fails');
  assert.equal(persisted.id, created.id);
}

function checkpointRefreshFailureCannotReclassifySave(): void {
  const source = readFileSync(
    new URL('../../packages/frontend/src/features/agent/host/AgentAppSurface.vue', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('const saveCheckpoint = async');
  const end = source.indexOf('const resumeCheckpoint = async', start);
  assert(start >= 0 && end > start, 'saveCheckpoint implementation must be present');
  const body = source.slice(start, end);

  const createIndex = body.indexOf('const created = await facade.saveCheckpoint');
  const successIndex = body.indexOf('runtimeOperation.succeed()');
  const resyncIndex = body.indexOf('await postCommitSync(refreshCheckpoints');

  assert(createIndex >= 0, 'checkpoint create result must be captured');
  assert(successIndex > createIndex, 'checkpoint mutation must be marked successful after create returns');
  assert(resyncIndex > successIndex, 'checkpoint list refresh must run only after mutation success is established');
  assert(
    !body.slice(createIndex, successIndex).includes('await facade.listCheckpoints'),
    'checkpoint list refresh must not be able to reject the committed save before success is recorded',
  );
}

async function main(): Promise<void> {
  await providerNotificationFailureDoesNotReverseCreate();
  checkpointRefreshFailureCannotReclassifySave();
  process.stdout.write('agent post-commit boundary regression: PASS\n');
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});

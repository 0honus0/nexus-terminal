import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAgentSettingsRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import {
  createDefaultAgentSettings,
  normalizeRequestedSettings,
} from '../../../packages/backend/src/modules/agent/agent-defaults';
import { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';

export const providerSettingsDeadFieldScenario = async () => {
  const defaults = createDefaultAgentSettings() as unknown as Record<string, unknown>;
  assert.equal('safety' in defaults, false, 'new Agent settings must not serialize the removed safety section');

  const legacyPayload = {
    ...createDefaultAgentSettings(),
    safety: { providerPrivateNetworkExceptions: ['127.0.0.1', 'internal.example'] },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyPayload),
    /VALIDATION_FAILED/,
    'settings with the removed safety section must fail closed',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-settings-dead-field-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'settings-dead-field.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'settings-user', 'not-used')");
    await db.execute(`INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, 1)`, [
      JSON.stringify(legacyPayload),
    ]);

    const repository = new SqliteAgentSettingsRepository(db);
    const service = new AgentSettingsService(
      repository,
      {
        get: async () => null,
        save: async () => undefined,
        delete: async () => undefined,
        deleteExpired: async () => undefined,
      } as never,
      { read: async () => ({ artifactUsedBytes: 0, artifactReservedBytes: 0 }) } as never,
      { nowUnixSeconds: () => 2 },
    );
    await assert.rejects(
      () => service.get(1),
      /VALIDATION_FAILED/,
      'persisted settings with the removed safety section must fail closed',
    );
    await db.execute('UPDATE agent_settings SET value_json = ? WHERE user_id = 1', [
      JSON.stringify(createDefaultAgentSettings()),
    ]);
    const loaded = await service.get(1);
    assert.equal('safety' in (loaded.requestedSettings as unknown as Record<string, unknown>), false);
    assert.equal('safety' in (loaded.effectiveSettings as unknown as Record<string, unknown>), false);

    await assert.rejects(
      () => service.patch(1, { safety: { providerPrivateNetworkExceptions: ['127.0.0.1'] } }, 1),
      /VALIDATION_FAILED/,
      'removed safety patch surface must fail closed',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

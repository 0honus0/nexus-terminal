import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAgentSettingsRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { parseRunBudget } from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import {
  createDefaultAgentSettings,
  normalizeRequestedSettings,
} from '../../../packages/backend/src/modules/agent/agent-defaults';
import { AgentSettingsService } from '../../../packages/backend/src/modules/agent/host/agent-settings.service';
import { AgentExecutionPolicyService } from '../../../packages/backend/src/modules/agent/host/agent-execution-policy.service';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';

export const budgetSettingsDeadFieldScenario = async () => {
  const deadSettingsKeys = ['maxContextTokens', 'maxOutputTokens', 'maxRawToolBytes'] as const;
  const assertDeadSettingsAbsent = (value: unknown, label: string): void => {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
    const settings = value as Record<string, unknown>;
    for (const sectionName of ['budget', 'hardLimits'] as const) {
      const section = settings[sectionName];
      assert.ok(section && typeof section === 'object' && !Array.isArray(section), `${label}.${sectionName} missing`);
      for (const key of deadSettingsKeys) {
        assert.equal(
          key in (section as Record<string, unknown>),
          false,
          `${label}.${sectionName}.${key} must not remain a saveable Agent setting`,
        );
      }
    }
  };

  assertDeadSettingsAbsent(createDefaultAgentSettings(), 'defaults');
  const currentDefaults = createDefaultAgentSettings() as unknown as Record<string, unknown>;
  const legacyPayload = {
    ...currentDefaults,
    budget: {
      ...(currentDefaults.budget as Record<string, unknown>),
      maxContextTokens: 1_111,
      maxOutputTokens: 222,
      maxRawToolBytes: 333,
    },
    hardLimits: {
      ...(currentDefaults.hardLimits as Record<string, unknown>),
      maxContextTokens: 4_444,
      maxOutputTokens: 555,
      maxRawToolBytes: 666,
    },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyPayload),
    /VALIDATION_FAILED/,
    'settings with removed budget fields must fail closed instead of being normalized',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-budget-dead-fields-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'budget-dead-fields.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'budget-dead-user', 'not-used')");
    await db.execute(`INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, 1)`, [
      JSON.stringify(createDefaultAgentSettings()),
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
      { read: async () => ({ artifactUsedBytes: 0, artifactReservedBytes: 0, executingRuntimes: 0 }) } as never,
      { nowUnixSeconds: () => 2 },
    );
    const loaded = await service.get(1);
    assertDeadSettingsAbsent(loaded.requestedSettings, 'GET requested settings');
    assertDeadSettingsAbsent(loaded.effectiveSettings, 'GET effective settings');
    assertDeadSettingsAbsent({ budget: {}, hardLimits: loaded.hardLimits }, 'GET hard limits');

    for (const key of deadSettingsKeys) {
      await assert.rejects(
        () => service.patch(1, { budget: { [key]: 999 } }, 1),
        /VALIDATION_FAILED/,
        `removed budget.${key} patch surface must fail closed`,
      );
      await assert.rejects(
        () => service.previewHardLimits(1, { [key]: 999 }, 1),
        /VALIDATION_FAILED/,
        `removed hardLimits.${key} preview surface must fail closed`,
      );
    }

    let storedPolicy = {
      key: 'agent.execution-policy.v1',
      value: {
        schemaVersion: 1,
        overrides: { maxRunSteps: 42, maxRawToolBytes: 777 },
      } as JsonValue,
      bytes: 1,
      version: 1,
      updatedAt: 1,
    };
    const executionPolicies = new AgentExecutionPolicyService(
      {
        get: async () => storedPolicy,
        put: async (_scope: Scope, key: string, value: JsonValue, expectedVersion: number | null) => {
          assert.equal(expectedVersion, storedPolicy.version);
          storedPolicy = { key, value, bytes: 1, version: storedPolicy.version + 1, updatedAt: 2 };
          return storedPolicy;
        },
        delete: async () => false,
      },
      service,
    );
    await assert.rejects(
      () => executionPolicies.get({ userId: 1, appId: 'scenario-app' }),
      /VALIDATION_FAILED/,
      'stored execution policy with removed fields must fail closed',
    );
    storedPolicy = {
      ...storedPolicy,
      value: { schemaVersion: 1, overrides: { maxRunSteps: 42 } } as JsonValue,
    };
    const currentPolicy = await executionPolicies.get({ userId: 1, appId: 'scenario-app' });
    assert.equal(currentPolicy.effective.maxRunSteps, 42);
    await assert.rejects(
      () => executionPolicies.replace({ userId: 1, appId: 'scenario-app' }, { maxRawToolBytes: 999 }, 1),
      /VALIDATION_FAILED/,
      'new app execution policy writes must reject maxRawToolBytes',
    );
    await executionPolicies.replace({ userId: 1, appId: 'scenario-app' }, { maxRunSteps: 43 }, 1);
    const persistedPolicyOverrides = (storedPolicy.value as { overrides?: Record<string, unknown> }).overrides ?? {};
    assert.equal(
      'maxRawToolBytes' in persistedPolicyOverrides,
      false,
      'current policy writes must contain only current fields',
    );

    const legacyRunBudget = {
      maxContextTokens: 16_384,
      maxOutputTokens: 4_096,
      maxRunSteps: 80,
      maxActiveExecutionSeconds: 1_800,
      toolTimeoutSeconds: 60,
      maxToolOutputBytes: 65_536,
      maxRawToolBytes: 10_485_760,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 1_000,
      maxSubagentMessageBytes: 1_048_576,
      contextPolicy: freezeRunContextPolicy('normal'),
      contextCompactionMode: 'balanced',
      revision: 1,
    };
    assert.throws(
      () => parseRunBudget(JSON.stringify(legacyRunBudget)),
      /AGENT_DURABLE_STATE_INVALID/,
      'durable Run budget with a removed field must fail closed',
    );
    const {
      maxRawToolBytes: _removedRawQuota,
      maxContextTokens: _removedContextCapability,
      maxOutputTokens: _removedOutputCapability,
      ...currentRunBudget
    } = legacyRunBudget;
    assert.deepEqual(
      parseRunBudget(JSON.stringify(currentRunBudget)),
      currentRunBudget,
      'new durable Run budgets without removed capability/quota fields must decode',
    );
    assert.throws(
      () =>
        parseRunBudget(
          JSON.stringify({
            ...currentRunBudget,
            contextPolicy: { ...currentRunBudget.contextPolicy, effectiveWindowPercent: 101 },
          }),
        ),
      /AGENT_DURABLE_STATE_INVALID/,
      'durable context policy percentages outside 1-100 must fail closed',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return [
    { name: 'saveable_dead_budget_fields', value: 0, unit: 'fields' },
    { name: 'removed_raw_quota_runtime_owners', value: 0, unit: 'owners' },
    { name: 'removed_budget_field_rejections', value: 1, unit: 'runs' },
  ];
};

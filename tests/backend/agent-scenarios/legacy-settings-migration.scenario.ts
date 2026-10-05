import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';
import {
  createDefaultAgentSettings,
  normalizeRequestedSettings,
} from '../../../packages/backend/src/modules/agent/agent-defaults';

export const legacySettingsMigrationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-settings-migration-'));
  const db = new DatabaseSync(path.join(directory, 'settings.sqlite'));
  try {
    db.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
      INSERT INTO migrations (id, name, applied_at) VALUES (47, 'previous migration', 1);
      CREATE TABLE agent_settings (user_id INTEGER PRIMARY KEY, value_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    const current = createDefaultAgentSettings();
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    delete (legacy.performance as Record<string, unknown>).maxConcurrentWorkspaceJobs;
    delete (legacy.model as Record<string, unknown>).fallbackModels;
    legacy.safety = { providerPrivateNetworkExceptions: ['legacy.example'] };
    Object.assign(legacy.budget as Record<string, unknown>, {
      maxRunTokens: 123,
      maxContextTokens: 456,
      maxOutputTokens: 789,
      maxRawToolBytes: 321,
      maxRunCostMicros: 654,
    });
    Object.assign(legacy.hardLimits as Record<string, unknown>, {
      maxRunTokens: 123,
      maxContextTokens: 456,
      maxOutputTokens: 789,
      maxRawToolBytes: 321,
      maxRunCostMicros: 654,
      workspaceIdleTtlSeconds: 600,
    });
    (legacy.workspaceRuntime as Record<string, unknown>).workspaceIdleTtlSeconds = 600;
    (legacy.budget as Record<string, unknown>).maxModelRequests = 37;
    assert.throws(() => normalizeRequestedSettings(legacy), /VALIDATION_FAILED/);

    const insert = db.prepare('INSERT INTO agent_settings VALUES (?, ?, ?, ?)');
    insert.run(1, JSON.stringify(legacy), 7, 100);
    const currentJson = JSON.stringify(current);
    insert.run(2, currentJson, 3, 200);
    const configured = structuredClone(current);
    configured.performance.maxConcurrentWorkspaceJobs = 2;
    const configuredJson = JSON.stringify(configured);
    insert.run(3, configuredJson, 4, 300);

    await runMigrations(db);
    const rows = db
      .prepare('SELECT user_id, value_json, revision, updated_at FROM agent_settings ORDER BY user_id')
      .all() as Array<{
      user_id: number;
      value_json: string;
      revision: number;
      updated_at: number;
    }>;
    const upgraded = normalizeRequestedSettings(JSON.parse(rows[0]!.value_json));
    assert.equal(upgraded.budget.maxModelRequests, 37);
    assert.equal(upgraded.performance.maxConcurrentWorkspaceJobs, 8);
    assert.deepEqual(upgraded.model.fallbackModels, []);
    assert.equal(rows[0]!.revision, 7);
    assert.equal(rows[0]!.updated_at, 100);
    assert.equal(rows[1]!.value_json, currentJson, 'current settings must remain untouched');
    assert.equal(rows[1]!.revision, 3);
    assert.equal(rows[2]!.value_json, configuredJson, 'existing configured capacity must not be overwritten');

    await runMigrations(db);
    const repeated = db.prepare('SELECT value_json FROM agent_settings WHERE user_id = 1').get() as {
      value_json: string;
    };
    assert.equal(repeated.value_json, rows[0]!.value_json, 'migration must be idempotent');
    return [{ name: 'legacy_agent_settings_upgraded', value: 1, unit: 'rows' }];
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

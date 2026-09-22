import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseToolInspection } from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';

export const legacyMachineInspectionMigrationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-legacy-machine-inspection-'));
  const db = new DatabaseSync(path.join(directory, 'legacy-machine-inspection.sqlite'));
  const legacyInspection = {
    toolName: 'machine_execute_shell',
    toolVersion: '1.0.0',
    normalizedArguments: { connectionId: 42, command: 'pwd' },
    target: {
      kind: 'machine',
      targetIdentity: 'ssh:42',
      endpoint: 'scenario-host:22',
      loginUser: 'scenario-user',
      configurationHash: 'scenario-config',
      connectionId: 42,
    },
    resourceKeys: ['ssh:42'],
    risk: 'mutate',
    mutation: true,
    operationHash: 'scenario-operation-hash',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  try {
    assert.throws(() => parseToolInspection(JSON.stringify(legacyInspection)), /AGENT_DURABLE_STATE_INVALID/);
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (44, 'pre-machine-inspection-canonicalization', 1800000000);
      CREATE TABLE agent_tool_calls (
        id TEXT PRIMARY KEY,
        inspection_json TEXT NOT NULL
      );
      CREATE TABLE agent_approvals (
        id TEXT PRIMARY KEY,
        inspection_json TEXT
      );
    `);
    db.prepare('INSERT INTO agent_tool_calls (id, inspection_json) VALUES (?, ?)').run(
      'legacy-tool',
      JSON.stringify(legacyInspection),
    );
    db.prepare('INSERT INTO agent_approvals (id, inspection_json) VALUES (?, ?)').run(
      'legacy-approval',
      JSON.stringify(legacyInspection),
    );

    await runMigrations(db);

    const toolRow = db.prepare("SELECT inspection_json FROM agent_tool_calls WHERE id = 'legacy-tool'").get() as {
      inspection_json: string;
    };
    const approvalRow = db
      .prepare("SELECT inspection_json FROM agent_approvals WHERE id = 'legacy-approval'")
      .get() as {
      inspection_json: string;
    };
    for (const raw of [toolRow.inspection_json, approvalRow.inspection_json]) {
      const inspection = parseToolInspection(raw);
      assert.equal(inspection.target.kind, 'ssh');
      assert.equal(inspection.target.target, 'ssh');
      assert.equal(inspection.target.id, '42');
      assert.equal(inspection.target.connectionId, 42);
    }
    const legacyRows = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM agent_tool_calls WHERE json_extract(inspection_json, '$.target.kind') = 'machine') +
          (SELECT COUNT(*) FROM agent_approvals WHERE json_extract(inspection_json, '$.target.kind') = 'machine') AS count`,
      )
      .get() as { count: number };
    assert.equal(legacyRows.count, 0, 'migration 45 must remove decodable legacy machine inspection targets');
    const version = db.prepare('SELECT MAX(id) AS version FROM migrations').get() as { version: number };
    assert.equal(version.version, 45);

    return [
      { name: 'legacy_machine_inspections_migrated', value: 2, unit: 'rows' },
      { name: 'legacy_machine_inspections_remaining', value: legacyRows.count, unit: 'rows' },
      { name: 'migration_version', value: version.version, unit: 'version' },
    ];
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

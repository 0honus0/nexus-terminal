import type { DatabaseSync } from 'node:sqlite';
import type { SqliteMigration } from './migration.types';
import { columnExists, tableExists } from './schema-inspection';

// One-time data conversion. Runtime decoders accept only the current contracts.
const renameFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(renameFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === 'maxRunSteps' || key === 'maxSteps' ? 'maxModelRequests' : key,
      renameFields(item),
    ]),
  );
};

export const executionBudgetMigrations: SqliteMigration[] = [
  {
    id: 53,
    name: 'Replace mixed execution steps with cumulative request and tool budgets',
    sql: '',
    apply: async (db: DatabaseSync): Promise<void> => {
      if (await tableExists(db, 'agent_delegations')) {
        if (await columnExists(db, 'agent_delegations', 'max_steps'))
          db.exec('ALTER TABLE agent_delegations RENAME COLUMN max_steps TO max_model_requests');
        if (await columnExists(db, 'agent_delegations', 'used_steps')) {
          db.exec('ALTER TABLE agent_delegations RENAME COLUMN used_steps TO used_model_requests');
          db.exec(`UPDATE agent_delegations SET used_model_requests = (
          SELECT COUNT(*) FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
          WHERE s.run_id = agent_delegations.run_id AND s.agent_runtime_id = agent_delegations.child_runtime_id)`);
        }
      }
      if (await tableExists(db, 'agent_settings')) {
        const rows = db.prepare('SELECT user_id, value_json FROM agent_settings').all();
        const update = db.prepare('UPDATE agent_settings SET value_json = ? WHERE user_id = ?');
        for (const row of rows) {
          if (typeof row.value_json !== 'string') throw new Error('AGENT_SETTINGS_MIGRATION_INVALID');
          const value: unknown = renameFields(JSON.parse(row.value_json));
          if (
            !value ||
            typeof value !== 'object' ||
            !('hardLimits' in value) ||
            !value.hardLimits ||
            typeof value.hardLimits !== 'object'
          )
            throw new Error('AGENT_SETTINGS_MIGRATION_INVALID');
          if (!('maxToolExecutions' in value.hardLimits)) Object.assign(value.hardLimits, { maxToolExecutions: 4000 });
          update.run(JSON.stringify(value), row.user_id);
        }
      }
      if (await tableExists(db, 'agent_app_storage')) {
        const rows = db
          .prepare(
            "SELECT user_id, app_id, key, value_json FROM agent_app_storage WHERE key IN ('agent.execution-policy.v1','subagent.profiles.v1')",
          )
          .all();
        const update = db.prepare(
          'UPDATE agent_app_storage SET value_json = ?, bytes = ? WHERE user_id = ? AND app_id = ? AND key = ?',
        );
        for (const row of rows) {
          if (typeof row.value_json !== 'string') throw new Error('AGENT_POLICY_MIGRATION_INVALID');
          const value = JSON.stringify(renameFields(JSON.parse(row.value_json)));
          update.run(value, Buffer.byteLength(value, 'utf8'), row.user_id, row.app_id, row.key);
        }
      }
      if (await tableExists(db, 'agent_runs')) {
        db.exec(`UPDATE agent_runs SET
        budget_json = json_remove(json_set(budget_json,
          '$.maxModelRequests', json_extract(budget_json, '$.maxRunSteps'),
          '$.modelRequestCeiling', json_extract(budget_json, '$.maxRunSteps'),
          '$.activeExecutionCeilingSeconds', json_extract(budget_json, '$.maxActiveExecutionSeconds'),
          '$.maxToolExecutions', 4000, '$.phase', 'executing', '$.stopReason', NULL,
          '$.extensionCount', 0, '$.progressSequence', 0), '$.maxRunSteps'),
        usage_json = json_remove(json_set(usage_json,
          '$.modelRequests', (SELECT COUNT(*) FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id WHERE s.run_id = agent_runs.id),
          '$.toolExecutions', (SELECT COUNT(*) FROM agent_tool_calls t WHERE t.run_id = agent_runs.id AND t.started_at IS NOT NULL)), '$.steps')
        WHERE json_type(budget_json, '$.maxRunSteps') IS NOT NULL;`);
      }
      if (await tableExists(db, 'agent_hard_limit_confirmations'))
        db.exec('DELETE FROM agent_hard_limit_confirmations');
    },
    verify: async (db: DatabaseSync): Promise<boolean> =>
      !(await tableExists(db, 'agent_delegations')) ||
      (!(await columnExists(db, 'agent_delegations', 'max_steps')) &&
        !(await columnExists(db, 'agent_delegations', 'used_steps'))),
  },
];

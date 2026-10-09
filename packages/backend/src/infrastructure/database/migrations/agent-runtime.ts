import type { DatabaseSync as Database } from 'node:sqlite';
import type { SqliteMigration } from './migration.types';
import { tableExists, columnExists, indexExists, getTableCreateSQL } from './schema-inspection';
import { createAiThreadEntrySearchIndexSQL, createAgentInputRequestsTableSQL } from '../schema/agent-execution';
import { createAiContextCheckpointsTableSQL, createAiMemorySearchIndexSQL } from '../schema/agent-ai';
import { createAgentRuntimeContextCheckpointsTableSQL } from '../schema/agent-collaboration';

export const agentRuntimeMigrations: SqliteMigration[] = [
	{
		id: 52,
		name: 'Persist isolated child runtime semantic context checkpoints',
		sql: createAgentRuntimeContextCheckpointsTableSQL,
	},
	{
		id: 51,
		name: 'Retire extractive Context checkpoints before semantic regeneration',

		check: async (db: Database): Promise<boolean> => tableExists(db, 'ai_context_checkpoints'),

		sql: `DELETE FROM ai_context_checkpoints WHERE strategy_version <> 'context-checkpoint-v2';`,
	},
	{
		id: 21,
		name: 'Track Agent thread title ownership',

		check: async (db: Database): Promise<boolean> => {
			const columnAlreadyExists = await columnExists(db, 'ai_threads', 'title_source');
			return !columnAlreadyExists;
		},

		sql: `
            ALTER TABLE ai_threads ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual'
              CHECK(title_source IN ('placeholder','auto','manual'));
            UPDATE ai_threads
            SET title_source = 'placeholder'
            WHERE title = 'New conversation'
              AND NOT EXISTS (
                SELECT 1 FROM ai_thread_entries e WHERE e.thread_id = ai_threads.id
              );
        `,
	},
	{
		id: 22,
		name: 'Use the current Agent tool risk enum in durable tool state',

		check: async (db: Database): Promise<boolean> => {
			const createSQL = await getTableCreateSQL(db, 'agent_tool_calls');
			if (!createSQL) return false;
			return !createSQL.includes("'control'") || !createSQL.includes("'forbidden'");
		},

		sql: `
            ALTER TABLE agent_approvals RENAME TO agent_approvals_old_risk_enum;
            ALTER TABLE agent_resource_quarantine RENAME TO agent_resource_quarantine_old_risk_enum;
            ALTER TABLE agent_tool_calls RENAME TO agent_tool_calls_old_risk_enum;

            CREATE TABLE agent_tool_calls (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                agent_runtime_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                provider_call_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_version TEXT NOT NULL,
                inspection_json TEXT NOT NULL CHECK(json_valid(inspection_json)),
                operation_hash TEXT NOT NULL,
                operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
                risk TEXT NOT NULL CHECK(risk IN ('read','control','mutate','destructive','forbidden')),
                status TEXT NOT NULL CHECK(status IN (
                  'proposed','awaiting_approval','ready','running','succeeded','verification_failed','failed','cancelled','reconciling'
                )),
                result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                UNIQUE(step_id, provider_call_id),
                UNIQUE(step_id, operation_hash),
                UNIQUE(id, run_id),
                FOREIGN KEY(step_id, run_id) REFERENCES agent_steps(id, run_id) ON DELETE CASCADE,
                FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
            );

            INSERT INTO agent_tool_calls (
              id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
              inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
              created_at, started_at, completed_at, version
            )
            SELECT
              id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
              inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
              created_at, started_at, completed_at, version
            FROM agent_tool_calls_old_risk_enum;

            CREATE TABLE agent_approvals (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                app_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                tool_call_id TEXT NOT NULL,
                requested_by_runtime_id TEXT NOT NULL,
                operation_hash TEXT NOT NULL,
                operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
                status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
                policy_revision INTEGER NOT NULL CHECK(policy_revision > 0),
                input_revision INTEGER NOT NULL CHECK(input_revision >= 0),
                decided_by_user_id INTEGER REFERENCES users(id),
                decided_at INTEGER,
                consumed_at INTEGER,
                requested_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                FOREIGN KEY(run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id) ON DELETE CASCADE,
                FOREIGN KEY(tool_call_id, run_id) REFERENCES agent_tool_calls(id, run_id) ON DELETE CASCADE,
                FOREIGN KEY(requested_by_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
            );

            INSERT INTO agent_approvals (
              id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
              operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
              decided_at, consumed_at, requested_at, expires_at, version
            )
            SELECT
              id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
              operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
              decided_at, consumed_at, requested_at, expires_at, version
            FROM agent_approvals_old_risk_enum;

            CREATE TABLE agent_resource_quarantine (
                resource_key TEXT PRIMARY KEY REFERENCES agent_resource_fences(resource_key) ON DELETE CASCADE,
                tool_call_id TEXT REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
                owner_type TEXT NOT NULL CHECK(owner_type IN ('agent','workspace','system')),
                owner_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                created_at INTEGER NOT NULL
            );

            INSERT INTO agent_resource_quarantine (
              resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
            )
            SELECT resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
            FROM agent_resource_quarantine_old_risk_enum;

            DROP TABLE agent_approvals_old_risk_enum;
            DROP TABLE agent_resource_quarantine_old_risk_enum;
            DROP TABLE agent_tool_calls_old_risk_enum;

            CREATE UNIQUE INDEX agent_one_active_approval ON agent_approvals(tool_call_id)
                WHERE status = 'requested' OR (status = 'approved' AND consumed_at IS NULL);
            CREATE INDEX agent_approval_expiry ON agent_approvals(status, expires_at);
            CREATE INDEX agent_approval_scope ON agent_approvals(user_id, app_id, run_id, requested_at);
        `,
	},
	{
		id: 23,
		name: 'Track durable Agent tool-call batch lineage',

		check: async (db: Database): Promise<boolean> => {
			if (!(await tableExists(db, 'agent_tool_calls'))) return false;
			return !(
				(await columnExists(db, 'agent_tool_calls', 'source_model_step_id')) &&
				(await columnExists(db, 'agent_tool_calls', 'batch_index')) &&
				(await columnExists(db, 'agent_tool_calls', 'batch_size')) &&
				(await indexExists(db, 'agent_tool_call_batch_lineage'))
			);
		},

		apply: async (db: Database): Promise<void> => {
			if (!(await columnExists(db, 'agent_tool_calls', 'source_model_step_id'))) {
				db.exec(`
          ALTER TABLE agent_tool_calls
            ADD COLUMN source_model_step_id TEXT REFERENCES agent_steps(id);
        `);
			}
			if (!(await columnExists(db, 'agent_tool_calls', 'batch_index'))) {
				db.exec(`
          ALTER TABLE agent_tool_calls
            ADD COLUMN batch_index INTEGER NOT NULL DEFAULT 0 CHECK(batch_index >= 0);
        `);
			}
			if (!(await columnExists(db, 'agent_tool_calls', 'batch_size'))) {
				db.exec(`
          ALTER TABLE agent_tool_calls
            ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 1 CHECK(batch_size >= 1);
        `);
			}
			db.exec(`
        CREATE INDEX IF NOT EXISTS agent_tool_call_batch_lineage
          ON agent_tool_calls(run_id, agent_runtime_id, source_model_step_id, batch_index);
      `);
		},

		verify: async (db: Database): Promise<boolean> => {
			if (!(await tableExists(db, 'agent_tool_calls'))) return true;
			return (
				(await columnExists(db, 'agent_tool_calls', 'source_model_step_id')) &&
				(await columnExists(db, 'agent_tool_calls', 'batch_index')) &&
				(await columnExists(db, 'agent_tool_calls', 'batch_size')) &&
				(await indexExists(db, 'agent_tool_call_batch_lineage'))
			);
		},

		sql: `
            ALTER TABLE agent_tool_calls
              ADD COLUMN source_model_step_id TEXT REFERENCES agent_steps(id);
            ALTER TABLE agent_tool_calls
              ADD COLUMN batch_index INTEGER NOT NULL DEFAULT 0 CHECK(batch_index >= 0);
            ALTER TABLE agent_tool_calls
              ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 1 CHECK(batch_size >= 1);
            CREATE INDEX IF NOT EXISTS agent_tool_call_batch_lineage
              ON agent_tool_calls(run_id, agent_runtime_id, source_model_step_id, batch_index);
        `,
	},
	{
		id: 24,
		name: 'Enforce Agent tool-call source model step run lineage on upgraded databases',
		sql: `
            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_run_insert
            BEFORE INSERT ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id AND run_id = NEW.run_id
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_run_mismatch');
            END;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_run_update
            BEFORE UPDATE OF source_model_step_id, run_id ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id AND run_id = NEW.run_id
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_run_mismatch');
            END;
        `,
	},
	{
		id: 25,
		name: 'Normalize Agent tool-call batch lineage and require model-step ownership',
		sql: `
            -- Migration #23 could only add a nullable lineage column to already-populated
            -- databases. Recover the canonical source model step from the durable step order:
            -- a Tool step belongs to the nearest preceding Model step in the same Runtime.
            UPDATE agent_tool_calls AS target
            SET source_model_step_id = (
              SELECT model_step.id
              FROM agent_steps AS tool_step
              JOIN agent_steps AS model_step
                ON model_step.run_id = target.run_id
               AND model_step.agent_runtime_id = target.agent_runtime_id
               AND model_step.kind = 'model'
               AND model_step.step_index < tool_step.step_index
              WHERE tool_step.id = target.step_id
                AND tool_step.run_id = target.run_id
              ORDER BY model_step.step_index DESC
              LIMIT 1
            )
            WHERE target.source_model_step_id IS NULL;

            -- Batch metadata added by #23 defaulted to 0/1 for historical rows. Recompute it
            -- from canonical Tool-step ordering for every source model step so upgraded and
            -- freshly-created databases expose the same projection.
            UPDATE agent_tool_calls AS target
            SET batch_index = (
                  SELECT COUNT(*)
                  FROM agent_tool_calls AS sibling
                  JOIN agent_steps AS sibling_step
                    ON sibling_step.id = sibling.step_id AND sibling_step.run_id = sibling.run_id
                  JOIN agent_steps AS target_step
                    ON target_step.id = target.step_id AND target_step.run_id = target.run_id
                  WHERE sibling.run_id = target.run_id
                    AND sibling.agent_runtime_id = target.agent_runtime_id
                    AND sibling.source_model_step_id = target.source_model_step_id
                    AND (
                      sibling_step.step_index < target_step.step_index OR
                      (sibling_step.step_index = target_step.step_index AND sibling.id < target.id)
                    )
                ),
                batch_size = (
                  SELECT COUNT(*)
                  FROM agent_tool_calls AS sibling
                  WHERE sibling.run_id = target.run_id
                    AND sibling.agent_runtime_id = target.agent_runtime_id
                    AND sibling.source_model_step_id = target.source_model_step_id
                )
            WHERE target.source_model_step_id IS NOT NULL;

            -- Fail the migration instead of preserving a runtime fallback if any durable Tool
            -- row cannot be mapped to a real Model step in the same Run/Runtime.
            CREATE TEMP TABLE agent_tool_lineage_migration_guard (
              invalid_count INTEGER NOT NULL CHECK(invalid_count = 0)
            );
            INSERT INTO agent_tool_lineage_migration_guard(invalid_count)
            SELECT COUNT(*)
            FROM agent_tool_calls AS target
            WHERE target.source_model_step_id IS NULL
               OR NOT EXISTS (
                    SELECT 1 FROM agent_steps AS model_step
                    WHERE model_step.id = target.source_model_step_id
                      AND model_step.run_id = target.run_id
                      AND model_step.agent_runtime_id = target.agent_runtime_id
                      AND model_step.kind = 'model'
                  );
            DROP TABLE agent_tool_lineage_migration_guard;

            DROP TRIGGER IF EXISTS agent_tool_call_source_model_run_insert;
            DROP TRIGGER IF EXISTS agent_tool_call_source_model_run_update;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_invariant_insert
            BEFORE INSERT ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id
                  AND run_id = NEW.run_id
                  AND agent_runtime_id = NEW.agent_runtime_id
                  AND kind = 'model'
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_invalid');
            END;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_invariant_update
            BEFORE UPDATE OF source_model_step_id, run_id, agent_runtime_id ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id
                  AND run_id = NEW.run_id
                  AND agent_runtime_id = NEW.agent_runtime_id
                  AND kind = 'model'
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_invalid');
            END;
        `,
	},
	{
		id: 26,
		name: 'Add durable Agent user-input clarification requests',

		check: async (db: Database): Promise<boolean> => !(await tableExists(db, 'agent_input_requests')),

		sql: createAgentInputRequestsTableSQL,
	},
	{
		id: 27,
		name: 'Add durable model provider continuation state',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_model_attempts')) &&
			!(await columnExists(db, 'agent_model_attempts', 'continuation_json')),

		sql: `
            ALTER TABLE agent_model_attempts
              ADD COLUMN continuation_json TEXT
              CHECK(continuation_json IS NULL OR json_valid(continuation_json));
        `,
	},
	{
		id: 28,
		name: 'Add rebuildable indexed Agent recall projections',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'ai_memories')) && (await tableExists(db, 'ai_thread_entries')),

		sql: `
            ${createAiThreadEntrySearchIndexSQL}
            ${createAiMemorySearchIndexSQL}
            DELETE FROM ai_memories_search;
            INSERT INTO ai_memories_search(rowid, terms)
            SELECT rowid, nexus_search_terms(content) FROM ai_memories;
            DELETE FROM ai_thread_entries_search;
            INSERT INTO ai_thread_entries_search(rowid, terms)
            SELECT rowid, nexus_ledger_search_terms(payload_json) FROM ai_thread_entries;
        `,
	},
	{
		id: 29,
		name: 'Add Provider live capability observations',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'ai_providers')) &&
			!(await columnExists(db, 'ai_providers', 'live_capabilities_json')),

		sql: `
            ALTER TABLE ai_providers
              ADD COLUMN live_capabilities_json TEXT NOT NULL DEFAULT '[]'
              CHECK(json_valid(live_capabilities_json));
        `,
	},
	{
		id: 30,
		name: 'Replace dead Context digests with durable Context checkpoints',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'ai_context_digests')) || !(await tableExists(db, 'ai_context_checkpoints')),

		sql: `
            DROP TABLE IF EXISTS ai_context_digests;
            ${createAiContextCheckpointsTableSQL}
        `,
	},
	{
		id: 31,
		name: 'Distinguish rolling Agent recovery checkpoints',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_checkpoints')) && !(await columnExists(db, 'agent_checkpoints', 'kind')),

		sql: `
            ALTER TABLE agent_checkpoints
              ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'
              CHECK(kind IN ('user','recovery'));
            CREATE UNIQUE INDEX IF NOT EXISTS agent_one_recovery_checkpoint_per_run
              ON agent_checkpoints(run_id) WHERE kind = 'recovery';
        `,
	},
	{
		id: 32,
		name: 'Freeze Subagent mutation governance mode on delegations',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_delegations')) &&
			!(await columnExists(db, 'agent_delegations', 'mutation_mode')),

		sql: `
            ALTER TABLE agent_delegations
              ADD COLUMN mutation_mode TEXT NOT NULL DEFAULT 'read-only'
              CHECK(mutation_mode IN ('read-only','governed'));
        `,
	},
	{
		id: 33,
		name: 'Add durable continuation payload to Agent input requests',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_input_requests')) &&
			!(await columnExists(db, 'agent_input_requests', 'continuation_json')),

		sql: `
            ALTER TABLE agent_input_requests
              ADD COLUMN continuation_json TEXT
              CHECK(continuation_json IS NULL OR json_valid(continuation_json));
        `,
	},
	{
		id: 34,
		name: 'Add ACP inner permission metadata to Agent approvals',

		check: async (db: Database): Promise<boolean> =>
			(await tableExists(db, 'agent_approvals')) &&
			(!(await columnExists(db, 'agent_approvals', 'kind')) ||
				!(await columnExists(db, 'agent_approvals', 'inspection_json'))),

		apply: async (db: Database): Promise<void> => {
			if (!(await columnExists(db, 'agent_approvals', 'kind'))) {
				db.exec(`
          ALTER TABLE agent_approvals
            ADD COLUMN kind TEXT NOT NULL DEFAULT 'tool'
            CHECK(kind IN ('tool','acp_permission'));
        `);
			}
			if (!(await columnExists(db, 'agent_approvals', 'inspection_json'))) {
				db.exec(`
          ALTER TABLE agent_approvals
            ADD COLUMN inspection_json TEXT
            CHECK(inspection_json IS NULL OR json_valid(inspection_json));
        `);
			}
		},

		verify: async (db: Database): Promise<boolean> => {
			if (!(await tableExists(db, 'agent_approvals'))) return true;
			return (
				(await columnExists(db, 'agent_approvals', 'kind')) &&
				(await columnExists(db, 'agent_approvals', 'inspection_json'))
			);
		},

		sql: `
            ALTER TABLE agent_approvals
              ADD COLUMN kind TEXT NOT NULL DEFAULT 'tool'
              CHECK(kind IN ('tool','acp_permission'));
            ALTER TABLE agent_approvals
              ADD COLUMN inspection_json TEXT
              CHECK(inspection_json IS NULL OR json_valid(inspection_json));
        `,
	},
];

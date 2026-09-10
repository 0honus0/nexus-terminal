import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  CheckpointRepositoryPort,
  CheckpointSnapshot,
  CheckpointView,
  SaveCheckpointCommand,
} from '../../../modules/agent/runtime/recovery/checkpoint.repository.port';
import type { RunDefinitionSnapshot } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { persistedPlan, RUN_COLUMNS, type RunRow } from './sqlite-run.mapper';

interface CheckpointRow {
  id: string;
  run_id: string;
  schema_version: 1;
  ledger_through: number;
  event_through: number;
  snapshot_json: string;
  created_at: number;
}

const mapRow = (row: CheckpointRow): CheckpointView => ({
  id: row.id,
  runId: row.run_id,
  schemaVersion: row.schema_version,
  ledgerThrough: row.ledger_through,
  eventThrough: row.event_through,
  snapshot: JSON.parse(row.snapshot_json) as CheckpointSnapshot,
  createdAt: row.created_at,
});

export class SqliteCheckpointRepository implements CheckpointRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async save(command: SaveCheckpointCommand): Promise<CheckpointView> {
    return this.db.transaction(async (tx) => {
      const run = await tx.queryOne<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id=? AND user_id=? AND app_id=?`,
        [command.runId, command.scope.userId, command.scope.appId],
      );
      if (!run) throw new Error('NOT_FOUND');
      if (run.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
      if (run.status === 'cancelling' || run.needs_reconciliation === 1) throw new Error('CHECKPOINT_NOT_SAFE');
      const unsafeTool = await tx.queryOne<{ id: string }>(
        `SELECT id FROM agent_tool_calls WHERE run_id=? AND status IN ('running','reconciling') LIMIT 1`,
        [run.id],
      );
      if (unsafeTool) throw new Error('CHECKPOINT_NOT_SAFE');

      const ledger = await tx.queryOne<{ value: number | null }>(
        'SELECT MAX(sequence) AS value FROM ai_thread_entries WHERE run_id=? AND user_id=? AND app_id=?',
        [run.id, command.scope.userId, command.scope.appId],
      );
      const completed = await tx.queryAll<{ id: string }>(
        `SELECT id FROM agent_steps WHERE run_id=? AND status='completed' ORDER BY step_index,id`,
        [run.id],
      );
      const evidence = await tx.queryAll<{ artifact_id: string }>(
        `SELECT artifact_id FROM agent_artifact_links WHERE run_id=? AND role='evidence' ORDER BY artifact_id`,
        [run.id],
      );
      const manifests = await tx.queryAll<{ retained_manifest_ref: string }>(
        `SELECT e.retained_manifest_ref FROM agent_environments e
         JOIN agent_environment_groups g ON g.id=e.group_id
         WHERE g.run_id=? AND g.user_id=? AND g.app_id=? AND e.retained_manifest_ref IS NOT NULL
         ORDER BY e.retained_manifest_ref`,
        [run.id, command.scope.userId, command.scope.appId],
      );
      const artifactRefs = [
        ...new Set([...evidence.map((row) => row.artifact_id), ...manifests.map((row) => row.retained_manifest_ref)]),
      ];
      for (const artifactId of artifactRefs) {
        const artifact = await tx.queryOne<{ status: string }>(
          `SELECT status FROM ai_artifacts WHERE id=? AND user_id=? AND app_id=?`,
          [artifactId, command.scope.userId, command.scope.appId],
        );
        if (!artifact || artifact.status !== 'ready') throw new Error('CHECKPOINT_ARTIFACT_UNAVAILABLE');
      }
      const definition = JSON.parse(run.definition_json) as RunDefinitionSnapshot;
      const snapshot: CheckpointSnapshot = {
        schemaVersion: 1,
        runId: run.id,
        ledgerThrough: ledger?.value ?? 0,
        planVersion: run.version,
        plan: persistedPlan(run.plan_json),
        completedStepIds: completed.map((row) => row.id),
        evidenceRefs: evidence.map((row) => row.artifact_id),
        modelConfigurationVersion: definition.model.configurationVersion,
        definitionVersion: command.definitionVersion,
        policyRevision: definition.policyRevision,
        environmentArtifactManifestRefs: manifests.map((row) => row.retained_manifest_ref),
      };
      const eventThrough = run.next_event_sequence - 1;
      await tx.execute(
        `INSERT INTO agent_checkpoints (id,run_id,schema_version,ledger_through,event_through,snapshot_json,created_at)
         VALUES (?,?,1,?,?,?,?)`,
        [command.checkpointId, run.id, snapshot.ledgerThrough, eventThrough, JSON.stringify(snapshot), command.now],
      );
      for (const artifactId of artifactRefs) {
        await tx.execute(
          `INSERT OR IGNORE INTO agent_artifact_links (artifact_id,run_id,role,created_at) VALUES (?,?,'checkpoint',?)`,
          [artifactId, run.id, command.now],
        );
      }
      const row = await tx.queryOne<CheckpointRow>(
        `SELECT id,run_id,schema_version,ledger_through,event_through,snapshot_json,created_at
         FROM agent_checkpoints WHERE id=?`,
        [command.checkpointId],
      );
      if (!row) throw new Error('CHECKPOINT_STATE_INVALID');
      return mapRow(row);
    });
  }

  async get(scope: { userId: number; appId: string }, checkpointId: string): Promise<CheckpointView | null> {
    const row = await this.db.queryOne<CheckpointRow>(
      `SELECT c.id,c.run_id,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
       FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
       WHERE c.id=? AND r.user_id=? AND r.app_id=?`,
      [checkpointId, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async list(scope: { userId: number; appId: string }, runId: string, limit = 50): Promise<CheckpointView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<CheckpointRow>(
      `SELECT c.id,c.run_id,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
       FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
       WHERE c.run_id=? AND r.user_id=? AND r.app_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ?`,
      [runId, scope.userId, scope.appId, limit],
    );
    return rows.map(mapRow);
  }

  async missingArtifactRefs(scope: { userId: number; appId: string }, checkpointId: string): Promise<string[]> {
    const checkpoint = await this.get(scope, checkpointId);
    if (!checkpoint) throw new Error('NOT_FOUND');
    const refs = [
      ...new Set([...checkpoint.snapshot.evidenceRefs, ...checkpoint.snapshot.environmentArtifactManifestRefs]),
    ];
    const missing: string[] = [];
    for (const artifactId of refs) {
      const artifact = await this.db.queryOne<{ status: string }>(
        `SELECT status FROM ai_artifacts WHERE id=? AND user_id=? AND app_id=?`,
        [artifactId, scope.userId, scope.appId],
      );
      if (!artifact || artifact.status !== 'ready') missing.push(artifactId);
    }
    return missing;
  }

  async supersedeUnconsumedApprovals(
    scope: { userId: number; appId: string },
    runId: string,
    now: number,
  ): Promise<number> {
    const result = await this.db.execute(
      `UPDATE agent_approvals SET status='superseded',decided_at=?,version=version+1
       WHERE run_id=? AND user_id=? AND app_id=?
         AND (status='requested' OR (status='approved' AND consumed_at IS NULL))`,
      [now, runId, scope.userId, scope.appId],
    );
    return result.changes;
  }
}

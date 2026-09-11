import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  CheckpointDelegationRecoveryEntry,
  CheckpointRecoveryHazards,
  CheckpointRepositoryPort,
  CheckpointSnapshot,
  CheckpointToolRecoveryEntry,
  CheckpointToolStatus,
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

interface ToolRecoveryRow {
  id: string;
  operation_hash: string;
  risk: 'read' | 'mutate' | 'destructive';
  status: CheckpointToolStatus;
  result_json: string | null;
  started_at: number | null;
}

interface DelegationRecoveryRow {
  id: string;
  status: CheckpointDelegationRecoveryEntry['status'];
}

interface QuarantineRecoveryRow {
  resource_key: string;
  tool_call_id: string | null;
}

const terminalToolStatuses: ReadonlySet<CheckpointToolStatus> = new Set([
  'succeeded',
  'verification_failed',
  'failed',
  'cancelled',
]);

const toolRecovery = (
  row: ToolRecoveryRow,
  quarantinedResourceKeys: readonly string[],
): CheckpointToolRecoveryEntry => {
  let outcome: 'confirmed' | 'unknown' | null = null;
  let verificationStatus: CheckpointToolRecoveryEntry['verificationStatus'] = 'not_started';
  if (row.result_json) {
    try {
      const parsed = JSON.parse(row.result_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const result = parsed as Record<string, unknown>;
        if (result.outcome === 'confirmed' || result.outcome === 'unknown') outcome = result.outcome;
        const verification = result.verification;
        if (verification && typeof verification === 'object' && !Array.isArray(verification)) {
          const status = (verification as Record<string, unknown>).status;
          if (status === 'verified' || status === 'unverified' || status === 'failed') verificationStatus = status;
        }
      }
    } catch {
      outcome = null;
    }
  }
  const sideEffectStatus: CheckpointToolRecoveryEntry['sideEffectStatus'] =
    row.started_at === null
      ? 'not_started'
      : row.risk === 'read'
        ? 'confirmed'
        : outcome === 'confirmed'
          ? 'confirmed'
          : 'unknown';
  return {
    toolCallId: row.id,
    operationHash: row.operation_hash,
    risk: row.risk,
    status: row.status,
    sideEffectStatus,
    verificationStatus,
    quarantinedResourceKeys: [...quarantinedResourceKeys].sort(),
  };
};

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
      const tools = await tx.queryAll<ToolRecoveryRow>(
        `SELECT id, operation_hash, risk, status, result_json, started_at
         FROM agent_tool_calls WHERE run_id=? ORDER BY created_at,id`,
        [run.id],
      );
      if (tools.some((tool) => !terminalToolStatuses.has(tool.status))) throw new Error('CHECKPOINT_NOT_SAFE');

      const delegations = await tx.queryAll<DelegationRecoveryRow>(
        `SELECT id,status FROM agent_delegations WHERE run_id=? ORDER BY created_at,id`,
        [run.id],
      );
      if (delegations.some((delegation) => ['queued', 'running', 'waiting'].includes(delegation.status))) {
        throw new Error('CHECKPOINT_NOT_SAFE');
      }

      const quarantines = await tx.queryAll<QuarantineRecoveryRow>(
        `SELECT q.resource_key,q.tool_call_id
         FROM agent_resource_quarantine q
         JOIN agent_tool_calls t ON t.id=q.tool_call_id
         WHERE t.run_id=? ORDER BY q.resource_key`,
        [run.id],
      );
      if (quarantines.length > 0) throw new Error('CHECKPOINT_NOT_SAFE');
      const quarantineByTool = new Map<string, string[]>();
      for (const quarantine of quarantines) {
        if (!quarantine.tool_call_id) continue;
        const keys = quarantineByTool.get(quarantine.tool_call_id) ?? [];
        keys.push(quarantine.resource_key);
        quarantineByTool.set(quarantine.tool_call_id, keys);
      }
      const toolManifest = tools.map((tool) => toolRecovery(tool, quarantineByTool.get(tool.id) ?? []));
      if (toolManifest.some((tool) => tool.sideEffectStatus === 'unknown')) throw new Error('CHECKPOINT_NOT_SAFE');

      const ledger = await tx.queryOne<{ value: number | null }>(
        'SELECT MAX(sequence) AS value FROM ai_thread_entries WHERE run_id=? AND user_id=? AND app_id=?',
        [run.id, command.scope.userId, command.scope.appId],
      );
      const threadLedger = await tx.queryOne<{ value: number | null }>(
        'SELECT MAX(sequence) AS value FROM ai_thread_entries WHERE thread_id=? AND user_id=? AND app_id=?',
        [run.thread_id, command.scope.userId, command.scope.appId],
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
        `SELECT retained_manifest_ref FROM agent_workspaces
         WHERE run_id=? AND user_id=? AND app_id=? AND retained_manifest_ref IS NOT NULL
         ORDER BY retained_manifest_ref`,
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
      const eventThrough = run.next_event_sequence - 1;
      const currentRunThrough = ledger?.value ?? 0;
      const contextBoundary = definition.contextBoundary
        ? {
            baseThrough: definition.contextBoundary.baseThrough,
            runThrough: { ...definition.contextBoundary.runThrough, [run.id]: currentRunThrough },
          }
        : { baseThrough: threadLedger?.value ?? currentRunThrough, runThrough: {} };
      if (
        !Number.isSafeInteger(contextBoundary.baseThrough) ||
        contextBoundary.baseThrough < 0 ||
        Object.keys(contextBoundary.runThrough).length > 64 ||
        Object.values(contextBoundary.runThrough).some((through) => !Number.isSafeInteger(through) || through < 0)
      ) {
        throw new Error('CHECKPOINT_STATE_INVALID');
      }
      const snapshot: CheckpointSnapshot = {
        schemaVersion: 1,
        runId: run.id,
        ledgerThrough: currentRunThrough,
        planVersion: run.version,
        plan: persistedPlan(run.plan_json),
        completedStepIds: completed.map((row) => row.id),
        evidenceRefs: evidence.map((row) => row.artifact_id),
        modelConfigurationVersion: definition.model.configurationVersion,
        definitionVersion: command.definitionVersion,
        policyRevision: definition.policyRevision,
        workspaceArtifactManifestRefs: manifests.map((row) => row.retained_manifest_ref),
        recoveryManifest: {
          schemaVersion: 1,
          eventThrough,
          contextBoundary,
          tools: toolManifest,
          delegations: delegations.map((delegation) => ({ delegationId: delegation.id, status: delegation.status })),
          quarantinedResourceKeys: quarantines.map((quarantine) => quarantine.resource_key),
        },
      };
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
      ...new Set([...checkpoint.snapshot.evidenceRefs, ...checkpoint.snapshot.workspaceArtifactManifestRefs]),
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

  async recoveryHazards(
    scope: { userId: number; appId: string },
    checkpointId: string,
  ): Promise<CheckpointRecoveryHazards> {
    const checkpoint = await this.get(scope, checkpointId);
    if (!checkpoint) throw new Error('NOT_FOUND');
    const startedEvents = await this.db.queryAll<{ payload_json: string }>(
      `SELECT payload_json FROM agent_events
       WHERE run_id=? AND sequence>? AND type='tool.started' ORDER BY sequence`,
      [checkpoint.runId, checkpoint.eventThrough],
    );
    const startedToolIds = new Set<string>();
    for (const event of startedEvents) {
      try {
        const payload = JSON.parse(event.payload_json) as unknown;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const toolCallId = (payload as Record<string, unknown>).toolCallId;
          if (typeof toolCallId === 'string' && toolCallId) startedToolIds.add(toolCallId);
        }
      } catch {
        throw new Error('CHECKPOINT_STATE_INVALID');
      }
    }
    const mutationTools = await this.db.queryAll<{ id: string }>(
      `SELECT id FROM agent_tool_calls WHERE run_id=? AND risk IN ('mutate','destructive') ORDER BY id`,
      [checkpoint.runId],
    );
    const quarantines = await this.db.queryAll<{ resource_key: string }>(
      `SELECT q.resource_key
       FROM agent_resource_quarantine q
       JOIN agent_tool_calls t ON t.id=q.tool_call_id
       WHERE t.run_id=? ORDER BY q.resource_key`,
      [checkpoint.runId],
    );
    return {
      postCheckpointMutationToolCallIds: mutationTools
        .map((tool) => tool.id)
        .filter((toolCallId) => startedToolIds.has(toolCallId)),
      quarantinedResourceKeys: [...new Set(quarantines.map((row) => row.resource_key))],
    };
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

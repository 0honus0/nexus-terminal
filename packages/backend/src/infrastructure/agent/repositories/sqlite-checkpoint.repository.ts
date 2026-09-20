import type { ToolRisk } from '../../../modules/agent/capabilities/tool.types';
import type {
  CheckpointBackgroundJobEntry,
  CheckpointBackgroundJobStatus,
  CheckpointDelegationRecoveryEntry,
  CheckpointRecoveryHazards,
  CheckpointRepositoryPort,
  CheckpointRunBackgroundJob,
  CheckpointSnapshot,
  CheckpointToolRecoveryEntry,
  CheckpointToolStatus,
  CheckpointView,
  SaveCheckpointCommand,
} from '../../../modules/agent/runtime/recovery/checkpoint.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import {
  decodeDurableStringArray,
  decodeRunPlan,
  durableInteger,
  durableRecord,
  durableString,
  parseDurableJson,
  parseRunDefinition,
  parseToolResult,
} from '../runtime/durable-state-decoders';
import { persistedPlan, RUN_COLUMNS, type RunRow } from './sqlite-run.mapper';

interface CheckpointRow {
  id: string;
  run_id: string;
  kind: CheckpointView['kind'];
  schema_version: 1;
  ledger_through: number;
  event_through: number;
  snapshot_json: string;
  created_at: number;
}

interface ToolRecoveryRow {
  id: string;
  tool_name: string;
  operation_hash: string;
  risk: ToolRisk;
  status: CheckpointToolStatus;
  result_json: string | null;
  started_at: number | null;
  created_at: number;
}

interface DelegationRecoveryRow {
  id: string;
  status: CheckpointDelegationRecoveryEntry['status'];
}

interface QuarantineRecoveryRow {
  resource_key: string;
  tool_call_id: string | null;
}

const backgroundJobStatuses: ReadonlySet<CheckpointBackgroundJobStatus> = new Set([
  'pending',
  'running',
  'succeeded',
  'failed',
  'unknown',
  'cancelled',
]);

const assertCheckpointKeys = (record: Record<string, unknown>, allowedKeys: readonly string[]): void => {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).length !== allowed.size || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('invalid');
  }
};

const backgroundJobFromTool = (row: ToolRecoveryRow): CheckpointBackgroundJobEntry | null => {
  if (!['workspace_execute_argv', 'workspace_job'].includes(row.tool_name) || !row.result_json) return null;
  const result = parseToolResult(row.result_json);
  if (!result.data || Array.isArray(result.data) || typeof result.data !== 'object') return null;
  const data = result.data as Record<string, unknown>;
  if (
    typeof data.jobId !== 'string' ||
    !/^job-[a-f0-9]{64}$/.test(data.jobId) ||
    typeof data.workspaceId !== 'string' ||
    data.workspaceId.length < 1 ||
    data.workspaceId.length > 128 ||
    !Number.isSafeInteger(data.generation) ||
    Number(data.generation) < 1 ||
    typeof data.status !== 'string' ||
    !backgroundJobStatuses.has(data.status as CheckpointBackgroundJobStatus)
  ) {
    return null;
  }
  return {
    jobId: data.jobId,
    workspaceId: data.workspaceId,
    generation: Number(data.generation),
    status: data.status as CheckpointBackgroundJobStatus,
  };
};

const decodeCheckpointSnapshot = (raw: string): CheckpointSnapshot => {
  try {
    const record = durableRecord(parseDurableJson(raw));
    assertCheckpointKeys(record, [
      'schemaVersion',
      'runId',
      'ledgerThrough',
      'planVersion',
      'inputRevision',
      'settingsRevision',
      'plan',
      'goal',
      'completedStepIds',
      'evidenceRefs',
      'checkpointArtifactRefs',
      'modelConfigurationVersion',
      'activeModel',
      'definitionVersion',
      'policyRevision',
      'workspaceArtifactManifestRefs',
      'workspaceArtifactRefs',
      'recoveryManifest',
    ]);
    if (record.schemaVersion !== 1) throw new Error('invalid');
    const goal = durableRecord(record.goal);
    assertCheckpointKeys(goal, ['text', 'revision', 'updatedAt']);
    const activeModel = durableRecord(record.activeModel);
    assertCheckpointKeys(activeModel, ['providerId', 'modelId', 'configurationVersion']);
    const recovery = durableRecord(record.recoveryManifest);
    assertCheckpointKeys(recovery, [
      'schemaVersion',
      'eventThrough',
      'contextBoundary',
      'tools',
      'delegations',
      'backgroundJobs',
      'quarantinedResourceKeys',
    ]);
    if (recovery.schemaVersion !== 1) throw new Error('invalid');
    const boundary = durableRecord(recovery.contextBoundary);
    assertCheckpointKeys(boundary, ['baseThrough', 'runThrough']);
    const runThrough = durableRecord(boundary.runThrough);
    if (Object.keys(runThrough).length > 64) throw new Error('invalid');
    if (!Array.isArray(recovery.tools) || recovery.tools.length > 4096) throw new Error('invalid');
    if (!Array.isArray(recovery.delegations) || recovery.delegations.length > 4096) throw new Error('invalid');
    if (!Array.isArray(recovery.backgroundJobs) || recovery.backgroundJobs.length > 256) throw new Error('invalid');
    const recoveryManifest: CheckpointSnapshot['recoveryManifest'] = {
      schemaVersion: 1,
      eventThrough: durableInteger(recovery.eventThrough),
      contextBoundary: {
        baseThrough: durableInteger(boundary.baseThrough),
        runThrough: Object.fromEntries(
          Object.entries(runThrough).map(([runId, sequence]) => [runId, durableInteger(sequence)]),
        ),
      },
      tools: recovery.tools.map((item) => {
        const tool = durableRecord(item);
        assertCheckpointKeys(tool, [
          'toolCallId',
          'operationHash',
          'risk',
          'status',
          'sideEffectStatus',
          'verificationStatus',
          'quarantinedResourceKeys',
        ]);
        if (!['read', 'control', 'mutate', 'destructive', 'forbidden'].includes(String(tool.risk)))
          throw new Error('invalid');
        if (
          ![
            'proposed',
            'awaiting_approval',
            'ready',
            'running',
            'succeeded',
            'verification_failed',
            'failed',
            'cancelled',
            'reconciling',
          ].includes(String(tool.status))
        )
          throw new Error('invalid');
        if (!['not_started', 'confirmed', 'unknown'].includes(String(tool.sideEffectStatus)))
          throw new Error('invalid');
        if (!['not_started', 'verified', 'unverified', 'failed'].includes(String(tool.verificationStatus)))
          throw new Error('invalid');
        return {
          toolCallId: durableString(tool.toolCallId) as string,
          operationHash: durableString(tool.operationHash) as string,
          risk: tool.risk as CheckpointToolRecoveryEntry['risk'],
          status: tool.status as CheckpointToolRecoveryEntry['status'],
          sideEffectStatus: tool.sideEffectStatus as CheckpointToolRecoveryEntry['sideEffectStatus'],
          verificationStatus: tool.verificationStatus as CheckpointToolRecoveryEntry['verificationStatus'],
          quarantinedResourceKeys: decodeDurableStringArray(tool.quarantinedResourceKeys, 4096),
        };
      }),
      delegations: recovery.delegations.map((item) => {
        const delegation = durableRecord(item);
        assertCheckpointKeys(delegation, ['delegationId', 'status']);
        if (!['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'].includes(String(delegation.status)))
          throw new Error('invalid');
        return {
          delegationId: durableString(delegation.delegationId) as string,
          status: delegation.status as CheckpointDelegationRecoveryEntry['status'],
        };
      }),
      backgroundJobs: recovery.backgroundJobs.map((item) => {
        const job = durableRecord(item);
        assertCheckpointKeys(job, ['jobId', 'workspaceId', 'generation', 'status']);
        if (!backgroundJobStatuses.has(String(job.status) as CheckpointBackgroundJobStatus)) {
          throw new Error('invalid');
        }
        return {
          jobId: durableString(job.jobId) as string,
          workspaceId: durableString(job.workspaceId) as string,
          generation: durableInteger(job.generation, 1),
          status: job.status as CheckpointBackgroundJobStatus,
        };
      }),
      quarantinedResourceKeys: decodeDurableStringArray(recovery.quarantinedResourceKeys, 4096),
    };
    return {
      schemaVersion: 1,
      runId: durableString(record.runId) as string,
      ledgerThrough: durableInteger(record.ledgerThrough),
      planVersion: durableInteger(record.planVersion),
      inputRevision: durableInteger(record.inputRevision),
      settingsRevision: durableInteger(record.settingsRevision, 1),
      plan: decodeRunPlan(record.plan),
      goal: {
        text: durableString(goal.text, true),
        revision: durableInteger(goal.revision),
        updatedAt: goal.updatedAt === null ? null : durableInteger(goal.updatedAt),
      },
      completedStepIds: decodeDurableStringArray(record.completedStepIds, 4096),
      evidenceRefs: decodeDurableStringArray(record.evidenceRefs, 4096),
      checkpointArtifactRefs: decodeDurableStringArray(record.checkpointArtifactRefs, 8192),
      modelConfigurationVersion: durableInteger(record.modelConfigurationVersion, 1),
      activeModel: {
        providerId: durableString(activeModel.providerId) as string,
        modelId: durableString(activeModel.modelId) as string,
        configurationVersion: durableInteger(activeModel.configurationVersion, 1),
      },
      definitionVersion: durableString(record.definitionVersion) as string,
      policyRevision: durableInteger(record.policyRevision, 1),
      workspaceArtifactManifestRefs: decodeDurableStringArray(record.workspaceArtifactManifestRefs, 4096),
      workspaceArtifactRefs: decodeDurableStringArray(record.workspaceArtifactRefs, 4096),
      recoveryManifest,
    };
  } catch {
    throw new Error('CHECKPOINT_STATE_INVALID');
  }
};

const checkpointArtifactRefs = (snapshot: CheckpointSnapshot): string[] => [...snapshot.checkpointArtifactRefs];

const cleanupCheckpointArtifactLinks = async (
  db: RelationalDatabase,
  runId: string,
  releasedArtifactRefs: readonly string[],
): Promise<void> => {
  if (releasedArtifactRefs.length === 0) return;
  const remainingRows = await db.queryAll<{ snapshot_json: string }>(
    `SELECT snapshot_json FROM agent_checkpoints WHERE run_id=? ORDER BY created_at,id`,
    [runId],
  );
  const retained = new Set<string>();
  for (const row of remainingRows) {
    for (const artifactId of checkpointArtifactRefs(decodeCheckpointSnapshot(row.snapshot_json)))
      retained.add(artifactId);
  }
  const releasedManifestRefs = new Set<string>();
  for (const artifactId of releasedArtifactRefs) {
    if (retained.has(artifactId)) continue;
    await db.execute(`DELETE FROM agent_artifact_links WHERE artifact_id=? AND run_id=? AND role='checkpoint'`, [
      artifactId,
      runId,
    ]);
    releasedManifestRefs.add(artifactId);
  }
  if (releasedManifestRefs.size > 0) {
    for (const artifactId of releasedManifestRefs) {
      await db.execute(
        `UPDATE agent_workspaces SET retained_manifest_ref=NULL
         WHERE run_id=? AND retained_manifest_ref=?`,
        [runId, artifactId],
      );
    }
  }
};

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
      const result = parseToolResult(row.result_json);
      outcome = result.outcome;
      verificationStatus = result.verification.status;
    } catch {
      throw new Error('CHECKPOINT_STATE_INVALID');
    }
  }
  const mutatingRisk = row.risk === 'mutate' || row.risk === 'destructive';
  const sideEffectStatus: CheckpointToolRecoveryEntry['sideEffectStatus'] =
    row.started_at === null ? 'not_started' : !mutatingRisk || outcome === 'confirmed' ? 'confirmed' : 'unknown';
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
  kind: row.kind,
  schemaVersion: row.schema_version,
  ledgerThrough: row.ledger_through,
  eventThrough: row.event_through,
  snapshot: decodeCheckpointSnapshot(row.snapshot_json),
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
        `SELECT id, tool_name, operation_hash, risk, status, result_json, started_at, created_at
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
      const backgroundJobs = command.backgroundJobs;
      if (
        backgroundJobs.length > 256 ||
        new Set(backgroundJobs.map((job) => job.jobId)).size !== backgroundJobs.length ||
        backgroundJobs.some(
          (job) =>
            !/^job-[a-f0-9]{64}$/.test(job.jobId) ||
            !job.workspaceId ||
            job.workspaceId.length > 128 ||
            !Number.isSafeInteger(job.generation) ||
            job.generation < 1 ||
            !['succeeded', 'failed', 'cancelled'].includes(job.status),
        )
      ) {
        throw new Error('CHECKPOINT_NOT_SAFE');
      }

      const workspaceCaptures = command.workspaceCaptures;
      const workspaceReference = command.workspaceReference;
      if (
        (workspaceCaptures.length > 0 && workspaceReference !== undefined) ||
        workspaceCaptures.length > 64 ||
        new Set(workspaceCaptures.map((capture) => capture.workspaceId)).size !== workspaceCaptures.length
      ) {
        throw new Error('CHECKPOINT_STATE_INVALID');
      }
      for (const capture of workspaceCaptures) {
        if (
          !capture.artifactRefs.includes(capture.manifestArtifactId) ||
          capture.artifactRefs.length < 2 ||
          capture.artifactRefs.length > 16 ||
          new Set(capture.artifactRefs).size !== capture.artifactRefs.length
        ) {
          throw new Error('CHECKPOINT_STATE_INVALID');
        }
        const workspace = await tx.queryOne<{ id: string; generation: number; version: number; status: string }>(
          `SELECT id,generation,version,status FROM agent_workspaces
           WHERE id=? AND run_id=? AND user_id=? AND app_id=?`,
          [capture.workspaceId, run.id, command.scope.userId, command.scope.appId],
        );
        if (
          !workspace ||
          workspace.generation !== capture.generation ||
          workspace.version !== capture.expectedVersion ||
          !['ready', 'running', 'stopped'].includes(workspace.status)
        ) {
          throw new Error('CHECKPOINT_NOT_SAFE');
        }
      }
      if (
        workspaceReference &&
        (workspaceReference.manifestArtifactIds.length > 64 ||
          workspaceReference.artifactRefs.length > 1024 ||
          new Set(workspaceReference.manifestArtifactIds).size !== workspaceReference.manifestArtifactIds.length ||
          new Set(workspaceReference.artifactRefs).size !== workspaceReference.artifactRefs.length ||
          workspaceReference.manifestArtifactIds.some(
            (artifactId) => !workspaceReference.artifactRefs.includes(artifactId),
          ))
      ) {
        throw new Error('CHECKPOINT_STATE_INVALID');
      }
      const workspaceArtifactRefs =
        workspaceReference?.artifactRefs ?? workspaceCaptures.flatMap((capture) => capture.artifactRefs);
      const manifestRefs =
        workspaceReference?.manifestArtifactIds ?? workspaceCaptures.map((capture) => capture.manifestArtifactId);
      const artifactRefs = [...new Set([...evidence.map((row) => row.artifact_id), ...workspaceArtifactRefs])];
      for (const artifactId of artifactRefs) {
        const artifact = await tx.queryOne<{ status: string }>(
          `SELECT status FROM ai_artifacts WHERE id=? AND user_id=? AND app_id=?`,
          [artifactId, command.scope.userId, command.scope.appId],
        );
        if (!artifact || artifact.status !== 'ready') throw new Error('CHECKPOINT_ARTIFACT_UNAVAILABLE');
      }
      const definition = parseRunDefinition(run.definition_json);
      const eventThrough = run.next_event_sequence - 1;
      const currentRunThrough = ledger?.value ?? 0;
      const contextBoundary = definition.contextBoundary
        ? {
            baseThrough: definition.contextBoundary.baseThrough,
            runThrough: { ...definition.contextBoundary.runThrough, [run.id]: currentRunThrough },
          }
        : {
            baseThrough: threadLedger?.value ?? currentRunThrough,
            runThrough: { [run.id]: currentRunThrough },
          };
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
        inputRevision: run.input_revision,
        settingsRevision: definition.settingsRevision,
        plan: persistedPlan(run.plan_json),
        goal: { text: run.goal_text, revision: run.goal_revision, updatedAt: run.goal_updated_at },
        completedStepIds: completed.map((row) => row.id),
        evidenceRefs: evidence.map((row) => row.artifact_id),
        checkpointArtifactRefs: [...artifactRefs].sort(),
        modelConfigurationVersion: command.activeModel.configurationVersion,
        activeModel: { ...command.activeModel },
        definitionVersion: command.definitionVersion,
        policyRevision: definition.policyRevision,
        workspaceArtifactManifestRefs: [...manifestRefs].sort(),
        workspaceArtifactRefs: [...new Set(workspaceArtifactRefs)].sort(),
        recoveryManifest: {
          schemaVersion: 1,
          eventThrough,
          contextBoundary,
          tools: toolManifest,
          delegations: delegations.map((delegation) => ({ delegationId: delegation.id, status: delegation.status })),
          backgroundJobs: backgroundJobs.map((job) => ({ ...job })),
          quarantinedResourceKeys: quarantines.map((quarantine) => quarantine.resource_key),
        },
      };
      const kind = command.kind;
      const supersededRecoveryArtifactRefs = new Set<string>();
      if (kind === 'recovery') {
        const superseded = await tx.queryAll<{ snapshot_json: string }>(
          `SELECT snapshot_json FROM agent_checkpoints WHERE run_id=? AND kind='recovery'`,
          [run.id],
        );
        for (const row of superseded) {
          const previous = decodeCheckpointSnapshot(row.snapshot_json);
          for (const artifactId of checkpointArtifactRefs(previous)) {
            supersededRecoveryArtifactRefs.add(artifactId);
          }
        }
        await tx.execute(`DELETE FROM agent_checkpoints WHERE run_id=? AND kind='recovery'`, [run.id]);
      }
      await tx.execute(
        `INSERT INTO agent_checkpoints (id,run_id,kind,schema_version,ledger_through,event_through,snapshot_json,created_at)
         VALUES (?,?,?,1,?,?,?,?)`,
        [
          command.checkpointId,
          run.id,
          kind,
          snapshot.ledgerThrough,
          eventThrough,
          JSON.stringify(snapshot),
          command.now,
        ],
      );
      for (const capture of workspaceCaptures) {
        const changed = await tx.execute(
          `UPDATE agent_workspaces
           SET retained_manifest_ref=?, version=version+1, updated_at=?
           WHERE id=? AND run_id=? AND user_id=? AND app_id=? AND generation=? AND version=?`,
          [
            capture.manifestArtifactId,
            command.now,
            capture.workspaceId,
            run.id,
            command.scope.userId,
            command.scope.appId,
            capture.generation,
            capture.expectedVersion,
          ],
        );
        if (changed.changes !== 1) throw new Error('CHECKPOINT_NOT_SAFE');
      }
      for (const artifactId of artifactRefs) {
        await tx.execute(
          `INSERT OR IGNORE INTO agent_artifact_links (artifact_id,run_id,role,created_at) VALUES (?,?,'checkpoint',?)`,
          [artifactId, run.id, command.now],
        );
      }
      await cleanupCheckpointArtifactLinks(tx, run.id, [...supersededRecoveryArtifactRefs]);
      const row = await tx.queryOne<CheckpointRow>(
        `SELECT id,run_id,kind,schema_version,ledger_through,event_through,snapshot_json,created_at
         FROM agent_checkpoints WHERE id=?`,
        [command.checkpointId],
      );
      if (!row) throw new Error('CHECKPOINT_STATE_INVALID');
      return mapRow(row);
    });
  }

  async get(scope: { userId: number; appId: string }, checkpointId: string): Promise<CheckpointView | null> {
    const row = await this.db.queryOne<CheckpointRow>(
      `SELECT c.id,c.run_id,c.kind,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
       FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
       WHERE c.id=? AND r.user_id=? AND r.app_id=?`,
      [checkpointId, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async list(scope: { userId: number; appId: string }, runId: string, limit = 50): Promise<CheckpointView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<CheckpointRow>(
      `SELECT c.id,c.run_id,c.kind,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
       FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
       WHERE c.run_id=? AND r.user_id=? AND r.app_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ?`,
      [runId, scope.userId, scope.appId, limit],
    );
    return rows.map(mapRow);
  }

  async latestRecovery(scope: { userId: number; appId: string }, runId: string): Promise<CheckpointView | null> {
    const row = await this.db.queryOne<CheckpointRow>(
      `SELECT c.id,c.run_id,c.kind,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
       FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
       WHERE c.run_id=? AND c.kind='recovery' AND r.user_id=? AND r.app_id=?
       ORDER BY c.created_at DESC,c.id DESC LIMIT 1`,
      [runId, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async deleteRecovery(scope: { userId: number; appId: string }, runId: string, checkpointId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await tx.queryOne<CheckpointRow>(
        `SELECT c.id,c.run_id,c.kind,c.schema_version,c.ledger_through,c.event_through,c.snapshot_json,c.created_at
         FROM agent_checkpoints c JOIN agent_runs r ON r.id=c.run_id
         WHERE c.id=? AND c.run_id=? AND c.kind='recovery' AND r.user_id=? AND r.app_id=?`,
        [checkpointId, runId, scope.userId, scope.appId],
      );
      if (!row) return;
      const released = checkpointArtifactRefs(decodeCheckpointSnapshot(row.snapshot_json));
      await tx.execute(`DELETE FROM agent_checkpoints WHERE id=? AND run_id=? AND kind='recovery'`, [
        checkpointId,
        runId,
      ]);
      await cleanupCheckpointArtifactLinks(tx, runId, released);
    });
  }

  async runBackgroundJobs(
    scope: { userId: number; appId: string },
    runId: string,
  ): Promise<CheckpointRunBackgroundJob[]> {
    const rows = await this.db.queryAll<ToolRecoveryRow>(
      `SELECT t.id,t.tool_name,t.operation_hash,t.risk,t.status,t.result_json,t.started_at,t.created_at
       FROM agent_tool_calls t
       JOIN agent_runs r ON r.id=t.run_id
       WHERE t.run_id=? AND r.user_id=? AND r.app_id=?
         AND t.tool_name IN ('workspace_execute_argv','workspace_job')
         AND t.result_json IS NOT NULL
       ORDER BY t.created_at,t.id`,
      [runId, scope.userId, scope.appId],
    );
    const jobs = new Map<string, CheckpointRunBackgroundJob>();
    for (const row of rows) {
      const projected = backgroundJobFromTool(row);
      if (!projected) continue;
      const current = jobs.get(projected.jobId);
      if (current && (current.workspaceId !== projected.workspaceId || current.generation !== projected.generation)) {
        throw new Error('CHECKPOINT_STATE_INVALID');
      }
      jobs.set(projected.jobId, {
        ...projected,
        toolCallIds: [...new Set([...(current?.toolCallIds ?? []), row.id])],
      });
    }
    return [...jobs.values()].sort((left, right) => left.jobId.localeCompare(right.jobId));
  }

  async missingArtifactRefs(scope: { userId: number; appId: string }, checkpointId: string): Promise<string[]> {
    const checkpoint = await this.get(scope, checkpointId);
    if (!checkpoint) throw new Error('NOT_FOUND');
    const refs = checkpointArtifactRefs(checkpoint.snapshot);
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
        const payload = durableRecord(parseDurableJson(event.payload_json));
        const toolCallId = durableString(payload.toolCallId) as string;
        if (toolCallId) startedToolIds.add(toolCallId);
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
}

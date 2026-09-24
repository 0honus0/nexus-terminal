import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { SqliteCheckpointRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-checkpoint.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { SqliteWorkspaceRepository } from '../../../packages/backend/src/infrastructure/agent/workspace-runtime/sqlite-workspace.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { WorkspaceCheckpointService } from '../../../packages/backend/src/modules/agent/runtime/recovery/workspace-checkpoint.service';
import {
  createWorkspaceCheckpointArchive,
  restoreWorkspaceCheckpointArchive,
} from '../../../packages/agent-runner/src/controller/workspace-checkpoint-archive';
import { SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const checkpointWorkspaceEvidenceScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-checkpoint-workspace-evidence-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'checkpoint-workspace-evidence.sqlite',
    nodeEnv: 'test',
  });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 16 * 1024 * 1024,
      maxGlobalArtifactBytes: 64 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const stateCommit = new SqliteStateCommitAdapter(db);
  const scenarioScope: Scope = { userId: 1, appId: 'checkpoint-workspace-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const runtimeId = randomUUID();
  const artifactSource = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();

  const budget = JSON.stringify({
    maxRunSteps: 100,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: 1_048_576,
    maxRecallItems: 10,
    maxRecallBytes: 65_536,
    maxSubagentMessages: 100,
    maxSubagentMessageBytes: 1_048_576,
    contextPolicy: freezeRunContextPolicy('normal'),
    contextCompactionMode: 'balanced',
    revision: 1,
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'checkpoint-workspace-agent',
    requiredModelCapabilities: [],
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'checkpoint-workspace-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'checkpoint workspace evidence', 'manual', ?, ?)`,
      [threadId, scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 1, ?, ?, ?)`,
      [runId, scenarioScope.appId, threadId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, 'checkpoint-workspace-owner', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('checkpoint-workspace-model-step', ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, runtimeId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('checkpoint-workspace-tool-step', ?, ?, 2, 'tool', 'created', 0, '[]', '[]', ?)`,
      [runId, runtimeId, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at)
       VALUES ('checkpoint-workspace-tool-call', ?, ?, 'checkpoint-workspace-tool-step',
               'checkpoint-workspace-model-step', 0, 1, 'checkpoint-workspace-provider-call',
               'artifact_read', '1.0.0', '{}', 'checkpoint-workspace-operation', 1, 'read', 'proposed', ?)`,
      [runId, runtimeId, now],
    );

    const reservation = await artifacts.begin(scenarioScope, {
      name: 'verified-evidence.txt',
      mediaType: 'text/plain',
      declaredBytes: 17,
    });
    const evidence = await artifacts.write(
      scenarioScope,
      reservation.artifactId,
      artifactSource(Buffer.from('verified evidence')),
      new AbortController().signal,
    );
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'input', ?)`,
      [evidence.id, runId, now],
    );

    const begun = await stateCommit.beginReadToolBatch({
      scope: scenarioScope,
      runId,
      runtimeId,
      expectedRunVersion: 1,
      items: [{ toolStepId: 'checkpoint-workspace-tool-step', toolCallId: 'checkpoint-workspace-tool-call' }],
      now: now + 1,
    });
    await stateCommit.settleReadToolBatch({
      scope: scenarioScope,
      runId,
      runtimeId,
      expectedRunVersion: begun.run.version,
      items: [
        {
          toolStepId: 'checkpoint-workspace-tool-step',
          toolCallId: 'checkpoint-workspace-tool-call',
          toolResultEntryId: randomUUID(),
          providerCallId: 'checkpoint-workspace-provider-call',
          result: {
            ok: true,
            summary: 'Evidence verified.',
            data: { artifactId: evidence.id },
            artifactRefs: [evidence.id],
            truncated: false,
            outcome: 'confirmed',
            verification: {
              status: 'verified',
              summary: 'The ready Artifact is durable verification evidence.',
              evidenceRefs: [evidence.id],
            },
          },
        },
      ],
      now: now + 2,
    });

    const evidenceLink = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_artifact_links
       WHERE run_id=? AND artifact_id=? AND role='evidence'`,
      [runId, evidence.id],
    );
    assert.equal(
      evidenceLink?.count,
      1,
      'P-099 requires Tool verification evidenceRefs to become durable role=evidence links at Tool settle',
    );

    const workspaceId = randomUUID();
    const workspaceProfile = {
      kind: 'code' as const,
      recipeId: 'scenario-code',
      recipeRevision: 'recipe-r1',
      runtimeDigest: 'a'.repeat(64),
      catalogRevision: 'catalog-r1',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    };
    await db.execute(
      `INSERT INTO agent_workspaces
        (id,user_id,app_id,run_id,agent_runtime_id,retained,kind,recipe_id,recipe_revision,runtime_digest,catalog_revision,
         toolchain_json,runner_plugins_json,generation,status,acp_profiles_json,browser_target_json,retained_manifest_ref,
         version,last_active_at,created_at,updated_at)
       VALUES (?,1,?,?,?,1,'code',?,?,?,?, '[]','[]',1,'running','[]',NULL,NULL,1,?,?,?)`,
      [
        workspaceId,
        scenarioScope.appId,
        runId,
        runtimeId,
        workspaceProfile.recipeId,
        workspaceProfile.recipeRevision,
        workspaceProfile.runtimeDigest,
        workspaceProfile.catalogRevision,
        now,
        now,
        now,
      ],
    );

    const sourceWork = path.join(directory, 'source-work');
    const targetWork = path.join(directory, 'target-work');
    const archiveScratch = path.join(directory, 'archive-scratch');
    fs.mkdirSync(path.join(sourceWork, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(targetWork, { recursive: true });
    fs.writeFileSync(path.join(sourceWork, 'README.md'), 'checkpoint workspace\n', 'utf8');
    fs.writeFileSync(path.join(sourceWork, 'src', 'nested', 'state.txt'), 'portable-state-v1\n', 'utf8');

    const directArchive = await createWorkspaceCheckpointArchive(sourceWork, archiveScratch);
    try {
      await restoreWorkspaceCheckpointArchive(
        targetWork,
        path.join(directory, 'restore-scratch'),
        directArchive.source,
        directArchive.sizeBytes,
      );
    } finally {
      await directArchive.close();
    }
    assert.equal(
      fs.readFileSync(path.join(targetWork, 'src', 'nested', 'state.txt'), 'utf8'),
      'portable-state-v1\n',
      'P-099 core Workspace archive must round-trip /workspace/work bytes',
    );

    const workspaceRepository = new SqliteWorkspaceRepository(db);
    const workspaceCheckpoints = new WorkspaceCheckpointService(
      workspaceRepository,
      {} as never,
      {
        openWorkspaceCheckpointArchive: async (requestedWorkspaceId: string, generation: number) => {
          assert.equal(requestedWorkspaceId, workspaceId);
          assert.equal(generation, 1);
          return createWorkspaceCheckpointArchive(sourceWork, path.join(directory, 'capture-scratch'));
        },
      } as never,
      artifacts,
    );
    const captures = await workspaceCheckpoints.capture(scenarioScope, runId);
    assert.equal(captures.length, 1);
    assert.equal(
      captures[0]?.artifactRefs.length,
      2,
      'manifest capture must bind manifest + portable archive Artifacts',
    );
    const manifests = await workspaceCheckpoints.validate(scenarioScope, runId, workspaceProfile, [
      captures[0]!.manifestArtifactId,
    ]);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.source.workspaceId, workspaceId);
    assert.equal(manifests[0]?.work.logicalRoot, '/workspace/work');

    await assert.rejects(
      () =>
        workspaceCheckpoints.validate(scenarioScope, runId, { ...workspaceProfile, runtimeDigest: 'b'.repeat(64) }, [
          captures[0]!.manifestArtifactId,
        ]),
      /CHECKPOINT_WORKSPACE_MANIFEST_INVALID/,
      'manifest restore must fail closed when the frozen Environment no longer matches',
    );

    const malformedBytes = Buffer.from('{"schemaVersion":1,"kind":"nexus.workspace.checkpoint"', 'utf8');
    const malformedReservation = await artifacts.begin(scenarioScope, {
      name: 'malformed-workspace-checkpoint.json',
      mediaType: 'application/vnd.nexus.workspace-checkpoint+json',
      declaredBytes: malformedBytes.byteLength,
    });
    const malformedManifest = await artifacts.write(
      scenarioScope,
      malformedReservation.artifactId,
      artifactSource(malformedBytes),
      new AbortController().signal,
    );
    await assert.rejects(
      () => workspaceCheckpoints.validate(scenarioScope, runId, workspaceProfile, [malformedManifest.id]),
      /CHECKPOINT_WORKSPACE_MANIFEST_INVALID/,
      'malformed Workspace checkpoint manifests must fail closed before resume creation',
    );

    const missingArchiveCapture = await workspaceCheckpoints.capture(scenarioScope, runId);
    const missingArchive = await artifacts.get(scenarioScope, missingArchiveCapture[0]!.artifactRefs[1]!);
    assert.ok(missingArchive);
    await artifacts.delete(scenarioScope, missingArchive!.id, missingArchive!.version);
    await assert.rejects(
      () =>
        workspaceCheckpoints.validate(scenarioScope, runId, workspaceProfile, [
          missingArchiveCapture[0]!.manifestArtifactId,
        ]),
      /CHECKPOINT_WORKSPACE_MANIFEST_INVALID/,
      'a manifest whose archive Artifact is missing must fail closed before resume creation',
    );

    const orphanReservation = await artifacts.begin(scenarioScope, {
      name: 'unlinked-orphan.txt',
      mediaType: 'text/plain',
      declaredBytes: 6,
    });
    const orphanArtifact = await artifacts.write(
      scenarioScope,
      orphanReservation.artifactId,
      artifactSource(Buffer.from('orphan')),
      new AbortController().signal,
    );

    const runVersion = await db.queryOne<{ version: number }>('SELECT version FROM agent_runs WHERE id=?', [runId]);
    assert.ok(runVersion);
    const checkpointRepository = new SqliteCheckpointRepository(db);
    const durableCheckpoint = await checkpointRepository.save({
      scope: scenarioScope,
      checkpointId: randomUUID(),
      kind: 'user',
      runId,
      expectedRunVersion: runVersion!.version,
      definitionVersion: '1.0.0',
      activeModel: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
      workspaceCaptures: captures,
      backgroundJobs: [],
      now: now + 3,
    });
    assert.deepEqual(
      durableCheckpoint.snapshot.workspaceArtifactManifestRefs,
      [captures[0]!.manifestArtifactId],
      'durable checkpoint must reference the manifest Artifact, not the old Workspace identity',
    );
    const retainedManifest = await db.queryOne<{ retained_manifest_ref: string | null; version: number }>(
      'SELECT retained_manifest_ref,version FROM agent_workspaces WHERE id=?',
      [workspaceId],
    );
    assert.equal(retainedManifest?.retained_manifest_ref, captures[0]!.manifestArtifactId);
    assert.equal(
      retainedManifest?.version,
      2,
      'checkpoint commit must CAS-bind the captured Workspace generation/version',
    );
    const checkpointLinks = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_artifact_links
       WHERE run_id=? AND role='checkpoint' AND artifact_id IN (?,?)`,
      [runId, captures[0]!.artifactRefs[0], captures[0]!.artifactRefs[1]],
    );
    assert.equal(checkpointLinks?.count, 2, 'manifest and archive Artifacts must both be checkpoint-protected');
    const orphanLinks = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agent_artifact_links WHERE run_id=? AND artifact_id=?',
      [runId, orphanArtifact.id],
    );
    assert.equal(
      orphanLinks?.count,
      0,
      'ready but unlinked Artifacts must not be promoted to evidence/checkpoint state by checkpoint save',
    );

    const resumedRunId = randomUUID();
    const resumedRuntimeId = randomUUID();
    const resumedWorkspaceId = randomUUID();
    const resumedWork = path.join(directory, 'resumed-work');
    fs.mkdirSync(resumedWork, { recursive: true });
    let resumedWorkspace: {
      userId: number;
      appId: string;
      id: string;
      runId: string;
      agentRuntimeId: string;
      retained: boolean;
      profile: typeof workspaceProfile;
      generation: number;
      status: 'ready' | 'running';
      retainedManifestRef: string | null;
      version: number;
      lastActiveAt: number;
      createdAt: number;
      updatedAt: number;
    } | null = null;
    const restoreRepository = {
      listWorkspaces: async (_scope: Scope, requestedRunId?: string) =>
        resumedWorkspace && (!requestedRunId || requestedRunId === resumedWorkspace.runId) ? [resumedWorkspace] : [],
      getWorkspace: async (_scope: Scope, requestedWorkspaceId: string) =>
        resumedWorkspace?.id === requestedWorkspaceId ? resumedWorkspace : null,
    };
    const restoreRuntime = {
      createWorkspace: async (
        _scope: Scope,
        requestedRunId: string,
        requestedRuntimeId: string,
        _spec: unknown,
        retained: boolean,
        _idempotencyKey: string,
        _catalogRevision: string,
        frozenProfile: typeof workspaceProfile,
      ) => {
        assert.equal(requestedRunId, resumedRunId);
        assert.equal(requestedRuntimeId, resumedRuntimeId);
        assert.notEqual(requestedRunId, runId);
        assert.notEqual(requestedRuntimeId, runtimeId);
        resumedWorkspace = {
          userId: scenarioScope.userId,
          appId: scenarioScope.appId,
          id: resumedWorkspaceId,
          runId: requestedRunId,
          agentRuntimeId: requestedRuntimeId,
          retained,
          profile: structuredClone(frozenProfile),
          generation: 1,
          status: 'ready',
          retainedManifestRef: null,
          version: 1,
          lastActiveAt: now + 4,
          createdAt: now + 4,
          updatedAt: now + 4,
        };
        return resumedWorkspace;
      },
      action: async (_scope: Scope, requestedWorkspaceId: string, action: string) => {
        assert.equal(requestedWorkspaceId, resumedWorkspaceId);
        assert.equal(action, 'start');
        assert.ok(resumedWorkspace);
        resumedWorkspace = { ...resumedWorkspace!, status: 'running', version: resumedWorkspace!.version + 1 };
        return {
          userId: scenarioScope.userId,
          appId: scenarioScope.appId,
          id: randomUUID(),
          workspaceId: resumedWorkspaceId,
          action: 'start',
          operationHash: 'checkpoint-restore-start',
          generation: 1,
          status: 'succeeded',
          result: null,
          deadlineAt: now + 60,
          createdAt: now + 4,
          completedAt: now + 4,
        };
      },
    };
    const restoreCheckpoints = new WorkspaceCheckpointService(
      restoreRepository as never,
      restoreRuntime as never,
      {
        restoreWorkspaceCheckpointArchive: async (
          requestedWorkspaceId: string,
          generation: number,
          source: AsyncIterable<Uint8Array>,
          expectedBytes: number,
        ) => {
          assert.equal(requestedWorkspaceId, resumedWorkspaceId);
          assert.equal(generation, 1);
          await restoreWorkspaceCheckpointArchive(
            resumedWork,
            path.join(directory, 'resumed-restore-scratch'),
            source,
            expectedBytes,
          );
        },
      } as never,
      artifacts,
    );
    await restoreCheckpoints.restore(scenarioScope, resumedRunId, resumedRuntimeId, manifests);
    assert.equal(resumedWorkspace?.status, 'running');
    assert.equal(resumedWorkspace?.runId, resumedRunId);
    assert.equal(resumedWorkspace?.agentRuntimeId, resumedRuntimeId);
    assert.equal(
      fs.readFileSync(path.join(resumedWork, 'README.md'), 'utf8'),
      'checkpoint workspace\n',
      'resumed Workspace must restore bytes into a new Run/runtime-owned Workspace',
    );

    const symlinkRoot = path.join(directory, 'unsafe-work');
    fs.mkdirSync(symlinkRoot, { recursive: true });
    fs.symlinkSync(path.join(sourceWork, 'README.md'), path.join(symlinkRoot, 'linked-readme'));
    await assert.rejects(
      () => createWorkspaceCheckpointArchive(symlinkRoot, path.join(directory, 'unsafe-scratch')),
      /WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE/,
      'checkpoint snapshot must reject symlinks instead of capturing host/runtime escape edges',
    );

    for (let index = 0; index < 32; index += 1) {
      await checkpointRepository.save({
        scope: scenarioScope,
        checkpointId: randomUUID(),
        kind: 'user',
        runId,
        expectedRunVersion: runVersion!.version,
        definitionVersion: '1.0.0',
        activeModel: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
        workspaceCaptures: [],
        workspaceReference: {
          manifestArtifactIds: [captures[0]!.manifestArtifactId],
          artifactRefs: [...captures[0]!.artifactRefs],
        },
        backgroundJobs: [],
        now: now + 10 + index,
      });
    }
    const retainedUsers = await checkpointRepository.list(scenarioScope, runId, 50);
    assert.equal(
      retainedUsers.filter((checkpoint) => checkpoint.kind === 'user').length,
      32,
      'user checkpoint retention must cap each Run at 32 entries',
    );
    assert.equal(
      retainedUsers.some((checkpoint) => checkpoint.id === durableCheckpoint.id),
      false,
      'the 33rd user checkpoint must evict the oldest owner instead of hiding it past list limit',
    );
    for (const checkpoint of retainedUsers.filter((candidate) => candidate.kind === 'user')) {
      await checkpointRepository.deleteUser(scenarioScope, runId, checkpoint.id);
    }
    const remainingUsers = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM agent_checkpoints WHERE run_id=? AND kind='user'",
      [runId],
    );
    assert.equal(remainingUsers?.count, 0, 'explicit user-checkpoint delete must remove the durable owner');
    const releasedCheckpointLinks = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_artifact_links
       WHERE run_id=? AND role='checkpoint' AND artifact_id IN (?,?)`,
      [runId, captures[0]!.artifactRefs[0], captures[0]!.artifactRefs[1]],
    );
    assert.equal(
      releasedCheckpointLinks?.count,
      0,
      'deleting the last checkpoint owner must release archive/manifest protection links',
    );
    const releasedManifest = await db.queryOne<{ retained_manifest_ref: string | null }>(
      'SELECT retained_manifest_ref FROM agent_workspaces WHERE id=?',
      [workspaceId],
    );
    assert.equal(
      releasedManifest?.retained_manifest_ref,
      null,
      'deleting the last checkpoint owner must release the Workspace retained manifest owner',
    );

    return [
      { name: 'checkpoint_tool_evidence_links', value: evidenceLink?.count ?? 0, unit: 'links' },
      { name: 'workspace_checkpoint_manifest_artifacts', value: captures[0]!.artifactRefs.length, unit: 'artifacts' },
      { name: 'workspace_checkpoint_protected_artifacts', value: checkpointLinks?.count ?? 0, unit: 'artifacts' },
      { name: 'workspace_checkpoint_roundtrips', value: 2, unit: 'cases' },
      { name: 'workspace_checkpoint_owner_takeovers', value: 0, unit: 'cases' },
      { name: 'workspace_checkpoint_user_retention_limit', value: 32, unit: 'checkpoints' },
      { name: 'workspace_checkpoint_user_delete_releases', value: 2, unit: 'artifacts' },
      { name: 'workspace_checkpoint_unsafe_symlink_rejections', value: 1, unit: 'cases' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

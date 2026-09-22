import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { createBrowserTools } from '../../../packages/backend/src/modules/agent/tools/host/browser-tools';
import { hashOperation } from '../../../packages/backend/src/modules/agent/operation-hash';
import { clock, emptyModelContinuations, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';

export const browserScreenshotVisionScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-browser-screenshot-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'browser-screenshot.sqlite', nodeEnv: 'test' });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 8 * 1024 * 1024,
      maxGlobalArtifactBytes: 64 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const stateCommit = new SqliteStateCommitAdapter(db);
  const scenarioScope: Scope = { userId: 1, appId: 'browser-screenshot-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const runtimeId = randomUUID();
  const sessionId = randomUUID();
  const targetRevision = 7;
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlC6VQAAAAASUVORK5CYII=',
    'base64',
  );
  let screenshotCalls = 0;
  const target = {
    id: 'visual-target',
    profileRevision: targetRevision,
    endpoints: [
      {
        scope: 'external-network' as const,
        via: 'backend' as const,
        url: 'https://browser.example.test',
        priority: 1,
        allowPlaintext: false,
        verifyTls: true,
      },
    ],
    allowedUrlPatterns: ['https://example.test/*'],
  };
  const targetConfigurationHash = hashOperation(
    {
      schemaVersion: 1,
      kind: 'browser-target',
      id: target.id,
      endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
      allowedUrlPatterns: [...target.allowedUrlPatterns],
    },
    cryptoHash,
  );
  const settings = {
    get: async () => ({
      revision: targetRevision,
      effectiveSettings: {
        browser: { targets: [target] },
      },
    }),
  };
  const browserSession = {
    userId: scenarioScope.userId,
    appId: scenarioScope.appId,
    runId,
    agentRuntimeId: runtimeId,
    sessionId,
    targetId: target.id,
    targetRevision,
    targetConfigurationHash,
    workspaceId: null,
    generation: null,
    url: 'https://example.test/chart',
    createdAt: now,
  };
  const gateway = {
    getSession: async () => browserSession,
    snapshot: async () => ({
      sessionId,
      snapshotId: 'semantic-live-snapshot',
      generation: null,
      targetId: target.id,
      url: browserSession.url,
      title: 'Visual chart',
      nodes: [
        {
          nodeRef: 'node-1',
          parentRef: null,
          tag: 'h1',
          role: 'heading',
          name: 'Revenue',
          text: 'Revenue',
          href: null,
          inputType: null,
          disabled: false,
        },
      ],
      truncated: false,
    }),
    screenshot: async () => {
      screenshotCalls += 1;
      return {
        sessionId,
        generation: null,
        targetId: target.id,
        url: browserSession.url,
        title: 'Visual chart',
        mediaType: 'image/png' as const,
        width: 1,
        height: 1,
        bytes: pngBytes,
      };
    },
    close: async () => undefined,
  };
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
    agentDefinitionId: 'browser-screenshot-agent',
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
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'browser-screenshot-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, ?, 'browser screenshot vision', 'manual', 3, ?, ?)`,
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
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, 'browser-screenshot-owner', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES
        ('browser-screenshot-user-input', ?, 1, ?, ?, 1, 'user_input', ?, ?),
        ('browser-screenshot-assistant', ?, 1, ?, ?, 2, 'assistant_message', ?, ?)`,
      [
        threadId,
        scenarioScope.appId,
        runId,
        JSON.stringify({ text: 'Inspect the chart visually.', artifactRefs: [] }),
        now,
        threadId,
        scenarioScope.appId,
        runId,
        JSON.stringify({
          text: '',
          toolCalls: [
            {
              id: 'browser-screenshot-provider-call',
              name: 'browser_screenshot',
              argumentsJson: JSON.stringify({ sessionId }),
            },
            {
              id: 'browser-semantic-provider-call',
              name: 'browser_snapshot',
              argumentsJson: JSON.stringify({ sessionId }),
            },
          ],
        }),
        now + 1,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('browser-screenshot-model-step', ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, runtimeId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('browser-screenshot-tool-step', ?, ?, 2, 'tool', 'created', 0, '[]', '[]', ?)`,
      [runId, runtimeId, now],
    );

    const tools = createBrowserTools(null!, settings as never, gateway as never, cryptoHash, artifacts);
    const screenshot = tools.find((tool) => tool.descriptor.name === 'browser_screenshot');
    const semantic = tools.find((tool) => tool.descriptor.name === 'browser_snapshot');
    assert.ok(
      screenshot,
      'P-083 requires one explicit on-demand browser_screenshot Tool while semantic browser_snapshot remains the default representation',
    );
    assert.ok(semantic, 'semantic browser_snapshot must remain present');
    assert.equal(screenshotCalls, 0, 'registering/discovering Browser tools must never capture pixels automatically');

    const toolContext: ToolContext = {
      ...scenarioScope,
      actor: {
        kind: 'agent',
        userId: scenarioScope.userId,
        appId: scenarioScope.appId,
        runId,
        agentRuntimeId: runtimeId,
      },
      runId,
      agentRuntimeId: runtimeId,
      connectionIds: [],
      environment: null,
      stepId: 'browser-screenshot-tool-step',
      signal: new AbortController().signal,
      deadlineAt: now + 120,
      maxOutputBytes: 1_048_576,
      inputRevision: 0,
    };
    const semanticInspection = await semantic!.inspect({ sessionId }, toolContext, 1);
    const semanticLiveResult = await semantic!.execute(semanticInspection, toolContext);
    assert.equal(semanticLiveResult.artifactRefs.length, 0);
    assert.equal(
      screenshotCalls,
      0,
      'ordinary semantic browser_snapshot execution must not capture pixels or create screenshot cost',
    );
    const inspected = await screenshot!.inspect({ sessionId }, toolContext, 1);
    assert.equal(screenshotCalls, 0, 'screenshot inspection must remain metadata-only and must not capture pixels');
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at)
       VALUES ('browser-screenshot-tool-call', ?, ?, 'browser-screenshot-tool-step',
               'browser-screenshot-model-step', 0, 1, 'browser-screenshot-provider-call',
               'browser_screenshot', '1.0.0', ?, ?, 1, 'read', 'proposed', ?)`,
      [runId, runtimeId, JSON.stringify(inspected), inspected.operationHash, now],
    );

    const begun = await stateCommit.beginReadToolBatch({
      scope: scenarioScope,
      runId,
      runtimeId,
      expectedRunVersion: 1,
      items: [{ toolStepId: 'browser-screenshot-tool-step', toolCallId: 'browser-screenshot-tool-call' }],
      now: now + 2,
    });
    const screenshotResult = await screenshot!.execute(inspected, toolContext);
    assert.equal(screenshotCalls, 1, 'pixels must be captured only by explicit browser_screenshot execution');
    assert.equal(screenshotResult.artifactRefs.length, 1);
    assert.equal(screenshotResult.verification.status, 'verified');
    assert.equal(screenshotResult.verification.evidenceRefs[0], screenshotResult.artifactRefs[0]);
    assert.equal(
      JSON.stringify(screenshotResult).includes(pngBytes.toString('base64')),
      false,
      'Browser ToolResult/Ledger metadata must never persist screenshot base64',
    );

    await stateCommit.settleReadToolBatch({
      scope: scenarioScope,
      runId,
      runtimeId,
      expectedRunVersion: begun.run.version,
      items: [
        {
          toolStepId: 'browser-screenshot-tool-step',
          toolCallId: 'browser-screenshot-tool-call',
          toolResultEntryId: 'browser-screenshot-result-entry',
          providerCallId: 'browser-screenshot-provider-call',
          result: screenshotResult,
        },
      ],
      now: now + 3,
    });
    const screenshotArtifactId = screenshotResult.artifactRefs[0]!;
    const links = await db.queryAll<{ role: string }>(
      'SELECT role FROM agent_artifact_links WHERE run_id=? AND artifact_id=? ORDER BY role',
      [runId, screenshotArtifactId],
    );
    assert.deepEqual(
      links.map((row) => row.role),
      ['evidence'],
      'verified Browser screenshot Artifact must be atomically linked as durable evidence at Tool settle',
    );

    const semanticResult = {
      ok: true,
      summary: 'Browser semantic snapshot captured.',
      data: { sessionId, snapshotId: 'semantic-snapshot', nodes: [] },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'unverified', summary: 'Semantic observation.', evidenceRefs: [] },
    };
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('browser-semantic-result-entry', ?, 1, ?, ?, 4, 'tool_result', ?, ?)`,
      [
        threadId,
        scenarioScope.appId,
        runId,
        JSON.stringify({ toolCallId: 'browser-semantic-provider-call', text: JSON.stringify(semanticResult) }),
        now + 4,
      ],
    );
    await db.execute('UPDATE ai_threads SET next_sequence=5, version=version+1, updated_at=? WHERE id=?', [
      now + 4,
      threadId,
    ]);

    const conversations = new ConversationService(new SqliteConversationRepository(db), clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      artifacts,
    );
    const compose = (supportsImageInput: boolean) =>
      context.compose({
        scope: scenarioScope,
        threadId,
        runId,
        currentInput: 'Inspect the chart visually.',
        currentInputEntryId: 'browser-screenshot-user-input',
        modelInputCapabilities: { supportsImageInput, supportsFileInput: false },
        modelContextWindow: 16_384,
        maxContextTokens: 16_384,
        reservedOutputTokens: 512,
        maxRecallItems: 1,
        maxRecallBytes: 1024,
        tools: [],
      });

    const visual = await compose(true);
    const toolIndexes = visual.messages.flatMap((message, index) => (message.role === 'tool' ? [index] : []));
    const observationIndex = visual.messages.findIndex(
      (message) =>
        message.role === 'user' &&
        message.content.startsWith('[Browser screenshot observation derived from the preceding browser_screenshot'),
    );
    assert.equal(
      toolIndexes.length,
      2,
      'parallel semantic + screenshot Tool results must remain a complete Tool batch',
    );
    assert.ok(
      observationIndex > Math.max(...toolIndexes),
      'visual observation must be appended after every Tool result',
    );
    const observation = visual.messages[observationIndex]!;
    assert.equal(observation.contentParts?.length, 1);
    assert.equal(observation.contentParts?.[0]?.type, 'image');
    assert.equal(observation.contentParts?.[0]?.artifactId, screenshotArtifactId);
    assert.equal(
      observation.contentParts?.[0]?.type === 'image' ? observation.contentParts[0].dataBase64 : '',
      pngBytes.toString('base64'),
      'native vision payload must be reconstructed from canonical Artifact bytes, not durable Ledger base64',
    );

    const semanticOnly = await compose(false);
    assert.equal(
      semanticOnly.messages.some((message) => message.contentParts?.some((part) => part.type === 'image')),
      false,
      'providers without image capability must continue with semantic/tool metadata and receive no native image part',
    );
    assert.equal(
      semanticOnly.messages.filter((message) => message.role === 'tool').length,
      2,
      'disabling image capability must not remove the semantic Browser Tool exchange',
    );

    return [
      { name: 'browser_screenshot_tools', value: 1, unit: 'tools' },
      { name: 'browser_semantic_snapshot_tools', value: 1, unit: 'tools' },
      { name: 'browser_explicit_screenshot_calls', value: screenshotCalls, unit: 'calls' },
      { name: 'browser_screenshot_artifacts', value: screenshotResult.artifactRefs.length, unit: 'artifacts' },
      {
        name: 'browser_screenshot_evidence_links',
        value: links.filter((row) => row.role === 'evidence').length,
        unit: 'links',
      },
      { name: 'browser_screenshot_native_image_parts', value: observation.contentParts?.length ?? 0, unit: 'parts' },
      { name: 'browser_screenshot_unsupported_native_parts', value: 0, unit: 'parts' },
      { name: 'browser_parallel_tool_batch_ordering', value: 1, unit: 'cases' },
      { name: 'browser_screenshot_durable_base64_leaks', value: 0, unit: 'cases' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

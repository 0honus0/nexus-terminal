import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { BrowserRuntimeAdapter } from '../../../packages/backend/src/infrastructure/agent/integrations/browser-runtime.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { createBrowserTools } from '../../../packages/backend/src/modules/agent/tools/host/browser-tools';
import { hashOperation } from '../../../packages/backend/src/modules/agent/operation-hash';

export const browserInteractionPrimitivesScenario = async () => {
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const descriptorTools = createBrowserTools(null!, null!, null!, cryptoHash);
  assert.deepEqual(
    descriptorTools.map((tool) => tool.descriptor.name),
    [
      'browser_create_session',
      'browser_snapshot',
      'browser_screenshot',
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_scroll',
      'browser_press',
      'browser_back',
      'browser_select',
      'browser_wait',
      'browser_console',
      'browser_upload',
      'browser_download',
      'browser_close',
    ],
    'Browser tool-family extraction must preserve the canonical model-visible Tool order',
  );
  const names = new Set(descriptorTools.map((tool) => tool.descriptor.name));
  for (const expected of [
    'browser_scroll',
    'browser_press',
    'browser_back',
    'browser_select',
    'browser_wait',
    'browser_console',
    'browser_upload',
    'browser_download',
  ]) {
    assert.ok(names.has(expected), `P-084 requires controlled Browser primitive ${expected}`);
  }

  const runtime = new BrowserRuntimeAdapter(null!);
  const runtimeSessionId = randomUUID();
  const runtimeRunId = randomUUID();
  const runtimeId = randomUUID();
  let currentUrl = 'https://example.test/form';
  const calls: Array<{ command: string; args: unknown }> = [];
  const keyboard: string[] = [];
  const page = {
    url: () => currentUrl,
    title: async () => 'Scenario page',
    waitForNetworkIdle: async () => undefined,
    mouse: {
      wheel: async (options: { deltaX?: number; deltaY?: number }) => {
        calls.push({ command: 'mouse.wheel', args: options });
      },
    },
    keyboard: {
      down: async (key: string) => {
        keyboard.push(`down:${key}`);
      },
      up: async (key: string) => {
        keyboard.push(`up:${key}`);
      },
      press: async (key: string) => {
        keyboard.push(`press:${key}`);
        if (key === 'Enter') currentUrl = 'https://example.test/submitted';
      },
    },
    goBack: async () => {
      currentUrl = 'https://example.test/form';
      return null;
    },
    evaluate: async () => ({
      ok: true,
      url: 'https://example.test/files/report.txt',
      mediaType: 'text/plain',
      disposition: 'attachment; filename="report.txt"',
      base64: Buffer.from('download-body', 'utf8').toString('base64'),
    }),
  };
  const cdp = {
    send: async (command: string, args: unknown) => {
      calls.push({ command, args });
      if (command === 'DOM.getBoxModel') return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
      if (command === 'DOM.resolveNode') return { object: { objectId: 'scenario-node-object' } };
      if (command === 'Runtime.callFunctionOn') return { result: { value: ['selected'] } };
      return {};
    },
  };
  const active = {
    request: {
      userId: 1,
      appId: 'browser-runtime-app',
      runId: runtimeRunId,
      agentRuntimeId: runtimeId,
      target: {
        id: 'runtime-target',
        profileRevision: 1,
        endpoints: [],
        allowedUrlPatterns: ['https://example.test/*'],
      },
    },
    target: {
      id: 'runtime-target',
      profileRevision: 1,
      endpoints: [],
      allowedUrlPatterns: ['https://example.test/*'],
    },
    transport: {},
    browser: {},
    context: {},
    page,
    cdp,
    createdAt: 1_800_000_000,
    snapshotId: 'runtime-snapshot',
    nodes: new Map([
      ['select-node', { backendNodeId: 1, tag: 'select', href: null, inputType: null }],
      ['input-node', { backendNodeId: 2, tag: 'input', href: null, inputType: 'file' }],
      ['download-node', { backendNodeId: 3, tag: 'a', href: '/files/report.txt', inputType: null }],
      ['button-node', { backendNodeId: 4, tag: 'button', href: null, inputType: null }],
    ]),
    consoleSequence: 3,
    consoleEntries: [
      { sequence: 1, type: 'log', text: 'boot', url: currentUrl, line: 1, column: 1 },
      { sequence: 2, type: 'warning', text: 'deprecated', url: currentUrl, line: 2, column: 1 },
      { sequence: 3, type: 'error', text: 'scenario console error', url: currentUrl, line: 3, column: 1 },
    ],
  };
  const runtimeHarness = runtime as unknown as { sessions: Map<string, unknown> };
  runtimeHarness.sessions.set(runtimeSessionId, active as unknown);

  const seedNodes = (): void => {
    active.snapshotId = 'runtime-snapshot';
    active.nodes = new Map([
      ['select-node', { backendNodeId: 1, tag: 'select', href: null, inputType: null }],
      ['input-node', { backendNodeId: 2, tag: 'input', href: null, inputType: 'file' }],
      ['download-node', { backendNodeId: 3, tag: 'a', href: '/files/report.txt', inputType: null }],
      ['button-node', { backendNodeId: 4, tag: 'button', href: null, inputType: null }],
    ]);
  };

  const scrollState = await runtime.scroll(
    runtimeSessionId,
    { deltaX: 0, deltaY: 900, settleMs: 0 },
    new AbortController().signal,
  );
  assert.equal(scrollState.url, currentUrl);
  await assert.rejects(
    () =>
      runtime.click(runtimeSessionId, 'runtime-snapshot', 'button-node', { settleMs: 0 }, new AbortController().signal),
    /BROWSER_NODE_STALE/,
    'scroll must invalidate old nodeRefs before the next node action',
  );
  seedNodes();

  const pressState = await runtime.press(
    runtimeSessionId,
    {
      snapshotId: 'runtime-snapshot',
      nodeRef: 'button-node',
      key: 'Enter',
      modifiers: ['Control'],
      settleMs: 0,
    },
    new AbortController().signal,
  );
  assert.equal(
    pressState.navigationChanged,
    true,
    'Enter-style actions must surface lightweight navigation change state',
  );
  assert.deepEqual(keyboard, ['down:Control', 'press:Enter', 'up:Control']);
  seedNodes();

  await runtime.select(
    runtimeSessionId,
    'runtime-snapshot',
    'select-node',
    ['blue'],
    { settleMs: 0 },
    new AbortController().signal,
  );
  assert.ok(
    calls.some(
      (call) => call.command === 'Runtime.callFunctionOn' && JSON.stringify(call.args).includes('HTMLSelectElement'),
    ),
    'select must use a fixed internal DOM operation bound to the opaque nodeRef',
  );
  seedNodes();

  const backState = await runtime.back(runtimeSessionId, { settleMs: 0 }, new AbortController().signal);
  assert.equal(backState.url, 'https://example.test/form');
  assert.equal(backState.navigationChanged, true);

  seedNodes();
  await runtime.wait(runtimeSessionId, { mode: 'timeout', maxMillis: 1 }, new AbortController().signal);
  await assert.rejects(
    () =>
      runtime.select(
        runtimeSessionId,
        'runtime-snapshot',
        'select-node',
        ['blue'],
        { settleMs: 0 },
        new AbortController().signal,
      ),
    /BROWSER_NODE_STALE/,
    'bounded wait must invalidate nodeRefs because asynchronous page changes may have occurred',
  );

  const consoleView = await runtime.console(
    runtimeSessionId,
    { afterCursor: 1, limit: 10, maxBytes: 4096 },
    new AbortController().signal,
  );
  assert.deepEqual(
    consoleView.entries.map((entry) => entry.type),
    ['warning', 'error'],
    'console reader must honor the cursor and preserve warn/error signal',
  );

  active.consoleSequence = 4;
  active.consoleEntries.push({
    sequence: 4,
    type: 'log',
    text: 'x'.repeat(1024),
    url: currentUrl,
    line: 4,
    column: 1,
  });
  const tinyConsolePage = await runtime.console(
    runtimeSessionId,
    { afterCursor: 3, limit: 10, maxBytes: 256 },
    new AbortController().signal,
  );
  assert.equal(tinyConsolePage.entries.length, 0);
  assert.equal(tinyConsolePage.truncated, true);
  assert.equal(
    tinyConsolePage.nextCursor,
    4,
    'console cursor must advance past one individually oversized entry instead of livelocking on the same page',
  );

  seedNodes();
  await runtime.upload(
    runtimeSessionId,
    'runtime-snapshot',
    'input-node',
    { name: 'source.txt', mediaType: 'text/plain', bytes: Buffer.from('upload-body', 'utf8') },
    { settleMs: 0 },
    new AbortController().signal,
  );
  const uploadCall = calls
    .filter((call) => call.command === 'Runtime.callFunctionOn')
    .find((call) => JSON.stringify(call.args).includes('HTMLInputElement'));
  assert.ok(uploadCall, 'upload must use a fixed internal file-input operation');
  assert.equal(
    JSON.stringify(uploadCall).includes('/tmp/') || JSON.stringify(uploadCall).includes('/workspace/'),
    false,
    'upload must not pass a Backend/Runner host path to the remote Browser',
  );

  seedNodes();
  const runtimeDownload = await runtime.download(
    runtimeSessionId,
    'runtime-snapshot',
    'download-node',
    { maxBytes: 1024 },
    new AbortController().signal,
  );
  assert.equal(Buffer.from(runtimeDownload.bytes).toString('utf8'), 'download-body');
  assert.equal(runtimeDownload.name, 'report.txt');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-browser-interaction-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'browser-interaction.sqlite', nodeEnv: 'test' });
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
  const scenarioScope: Scope = { userId: 1, appId: 'browser-interaction-app' };
  const threadId = randomUUID();
  const runId = randomUUID();
  const agentRuntimeId = randomUUID();
  const toolSessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const sourceBytes = Buffer.from('artifact-upload-source', 'utf8');
  const downloadedBytes = Buffer.from('artifact-download-result', 'utf8');
  const target = {
    id: 'interaction-target',
    profileRevision: 4,
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
      revision: target.profileRevision,
      effectiveSettings: { browser: { targets: [target] } },
    }),
  };
  let uploadedBytes = Buffer.alloc(0);
  const toolGateway = {
    getSession: async () => ({
      userId: scenarioScope.userId,
      appId: scenarioScope.appId,
      runId,
      agentRuntimeId,
      sessionId: toolSessionId,
      targetId: target.id,
      targetRevision: target.profileRevision,
      targetConfigurationHash,
      workspaceId: null,
      generation: null,
      url: 'https://example.test/form',
      createdAt: now,
    }),
    upload: async (
      _sessionId: string,
      _snapshotId: string,
      _nodeRef: string,
      file: { name: string; mediaType: string; bytes: Uint8Array },
    ) => {
      uploadedBytes = Buffer.from(file.bytes);
      return {
        sessionId: toolSessionId,
        generation: null,
        targetId: target.id,
        url: 'https://example.test/form',
        title: 'Upload form',
        navigationChanged: false,
      };
    },
    download: async () => ({
      sessionId: toolSessionId,
      generation: null,
      targetId: target.id,
      url: 'https://example.test/files/result.txt',
      name: 'result.txt',
      mediaType: 'text/plain',
      bytes: downloadedBytes,
    }),
    close: async () => undefined,
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'browser-interaction-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'browser interaction', 'manual', ?, ?)`,
      [threadId, scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started',
               '{}', '{}', '{}', '{}', 1, ?, ?, ?)`,
      [runId, scenarioScope.appId, threadId, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', '{}', 'running', 'executing', 0, 'browser-interaction-owner', ?, ?)`,
      [agentRuntimeId, runId, now, now],
    );

    const reservation = await artifacts.begin(scenarioScope, {
      name: 'source.txt',
      mediaType: 'text/plain',
      declaredBytes: sourceBytes.byteLength,
    });
    const sourceArtifact = await artifacts.write(
      scenarioScope,
      reservation.artifactId,
      (async function* () {
        yield sourceBytes;
      })(),
      new AbortController().signal,
    );
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'input', ?)`,
      [sourceArtifact.id, runId, now],
    );

    const tools = createBrowserTools(null!, settings as never, toolGateway as never, cryptoHash, artifacts);
    const uploadTool = tools.find((tool) => tool.descriptor.name === 'browser_upload')!;
    const downloadTool = tools.find((tool) => tool.descriptor.name === 'browser_download')!;
    const uploadSchema = uploadTool.descriptor.inputSchema as Record<string, JsonValue>;
    assert.equal(
      JSON.stringify(uploadSchema).includes('"path"'),
      false,
      'browser_upload input contract must not accept arbitrary host paths',
    );

    const toolContext: ToolContext = {
      ...scenarioScope,
      actor: {
        kind: 'agent',
        userId: scenarioScope.userId,
        appId: scenarioScope.appId,
        runId,
        agentRuntimeId,
      },
      runId,
      agentRuntimeId,
      connectionIds: [],
      environment: null,
      stepId: 'browser-interaction-step',
      signal: new AbortController().signal,
      deadlineAt: now + 120,
      maxOutputBytes: 1_048_576,
      inputRevision: 0,
    };

    const uploadInspection = await uploadTool.inspect(
      {
        sessionId: toolSessionId,
        snapshotId: 'snapshot-upload',
        nodeRef: 'file-input',
        artifactId: sourceArtifact.id,
        settleMs: 0,
      },
      toolContext,
      1,
    );
    const normalizedUpload = uploadInspection.normalizedArguments as Record<string, JsonValue>;
    assert.equal(normalizedUpload.sourceSha256, sourceArtifact.sha256);
    assert.equal(normalizedUpload.sourceSizeBytes, sourceArtifact.sizeBytes);
    const uploadResult = await uploadTool.execute(uploadInspection, toolContext);
    assert.deepEqual(uploadedBytes, sourceBytes, 'browser_upload must source bytes from the authorized Artifact');
    assert.deepEqual(
      uploadResult.artifactRefs,
      [sourceArtifact.id],
      'upload result must preserve source Artifact lineage',
    );

    const downloadInspection = await downloadTool.inspect(
      {
        sessionId: toolSessionId,
        snapshotId: 'snapshot-download',
        nodeRef: 'download-link',
        maxBytes: 1024,
      },
      toolContext,
      1,
    );
    const downloadResult = await downloadTool.execute(downloadInspection, toolContext);
    assert.equal(downloadResult.artifactRefs.length, 1);
    assert.equal(downloadResult.verification.status, 'verified');
    assert.deepEqual(downloadResult.verification.evidenceRefs, downloadResult.artifactRefs);
    const downloadedArtifact = await artifacts.get(scenarioScope, downloadResult.artifactRefs[0]!);
    assert.equal(downloadedArtifact?.status, 'ready');
    assert.equal(downloadedArtifact?.originalName, 'result.txt');
    const downloadedChunks: Buffer[] = [];
    for await (const chunk of artifacts.read(scenarioScope, downloadResult.artifactRefs[0]!, {
      start: 0,
      endInclusive: downloadedBytes.byteLength - 1,
    })) {
      downloadedChunks.push(Buffer.from(chunk));
    }
    assert.deepEqual(Buffer.concat(downloadedChunks), downloadedBytes);

    return [
      { name: 'browser_interaction_primitives', value: 8, unit: 'tools' },
      { name: 'browser_scroll_stale_node_rejections', value: 1, unit: 'cases' },
      { name: 'browser_press_navigation_state', value: pressState.navigationChanged ? 1 : 0, unit: 'cases' },
      { name: 'browser_select_controlled_dom_calls', value: 1, unit: 'cases' },
      { name: 'browser_back_navigation_state', value: backState.navigationChanged ? 1 : 0, unit: 'cases' },
      { name: 'browser_wait_stale_node_rejections', value: 1, unit: 'cases' },
      {
        name: 'browser_console_error_entries',
        value: consoleView.entries.filter((entry) => entry.type === 'error').length,
        unit: 'entries',
      },
      {
        name: 'browser_console_oversize_cursor_progress',
        value: tinyConsolePage.nextCursor === 4 ? 1 : 0,
        unit: 'cases',
      },
      { name: 'browser_upload_host_paths', value: 0, unit: 'paths' },
      { name: 'browser_upload_artifact_bytes', value: uploadedBytes.byteLength, unit: 'bytes' },
      { name: 'browser_download_artifacts', value: downloadResult.artifactRefs.length, unit: 'artifacts' },
      {
        name: 'browser_download_verified_evidence_refs',
        value: downloadResult.verification.evidenceRefs.length,
        unit: 'refs',
      },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

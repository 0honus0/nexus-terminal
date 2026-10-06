import http from 'node:http';
import regressionInputs from './regression-inputs.json' with { type: 'json' };

const host = '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT || 29091);
const expectedCredential = 'e2e-provider-secret';
let checkpointResponses = 0;
let releaseBrowserCompletion;
let browserCompletionReleased = false;
let browserCompletionHeld = false;
let releaseChildCancelParent;
let childCancelParentHeld = false;
let childCancelParentReleased = false;

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendSse = (response, value) => {
  const payload = Array.isArray(value?.choices)
    ? { ...value, choices: value.choices.map((choice, index) => ({ index, ...choice })) }
    : value;
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const regressionResponse = (response, delta, finishReason = 'stop') => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  sendSse(response, { choices: [{ delta, finish_reason: null }] });
  sendSse(response, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8 } });
  sendSse(response, { choices: [{ delta: {}, finish_reason: finishReason }] });
  response.end('data: [DONE]\n\n');
};

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/browser-lifecycle') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ held: browserCompletionHeld }));
    return;
  }
  if (request.url === '/child-cancel-parent') {
    if (request.method === 'POST') {
      childCancelParentReleased = true;
      releaseChildCancelParent?.();
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ held: childCancelParentHeld }));
    return;
  }
  if (request.method === 'POST' && request.url === '/browser-lifecycle/release') {
    browserCompletionReleased = true;
    releaseBrowserCompletion?.();
    response.writeHead(200);
    response.end();
    return;
  }
  const end = response.end.bind(response);
  response.end = (chunk, ...args) => {
    if (response.statusCode === 422) {
      console.error(`[E2E Agent Provider] 422 ${typeof chunk === 'string' ? chunk : ''}`);
    }
    return end(chunk, ...args);
  };
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, checkpointResponses }));
    return;
  }

  if (request.method === 'GET' && request.url === '/v1/models') {
    if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'e2e-model', object: 'model', owned_by: 'nexus-e2e', created: 1700000000 },
          {
            id: 'e2e-model-alt',
            object: 'model',
            owned_by: 'nexus-e2e',
            created: 1700000001,
            nexus_capabilities: {
              schema_version: 1,
              context_window: 16_384,
              max_output_tokens: 512,
              supports_tools: true,
              supports_image_input: true,
              supports_file_input: false,
              reasoning: {
                supported_efforts: ['low', 'high'],
                default_effort: 'low',
                mandatory: false,
              },
            },
          },
        ],
      }),
    );
    return;
  }

  if (request.method === 'POST' && request.url === '/redirect/chat/completions') {
    response.writeHead(302, { Location: `http://${host}:${port}/v1/chat/completions` });
    response.end();
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/responses') {
    if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
      return;
    }
    let body;
    try {
      body = await readJson(request);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      !['e2e-model', 'e2e-model-alt'].includes(body?.model) ||
      body?.stream !== true ||
      body?.max_output_tokens !== 16 ||
      body?.prompt_cache_key !== undefined ||
      !Array.isArray(body?.input)
    ) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'unexpected Responses test request' } }));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    const responseId = 'resp_e2e_provider_test';
    const messageId = 'msg_e2e_provider_test';
    sendSse(response, {
      type: 'response.created',
      response: { id: responseId, created_at: 1700000000, model: body.model },
    });
    sendSse(response, {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: messageId },
    });
    sendSse(response, { type: 'response.output_text.delta', item_id: messageId, output_index: 0, delta: 'OK' });
    sendSse(response, {
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'message', id: messageId },
    });
    sendSse(response, {
      type: 'response.completed',
      response: {
        usage: { input_tokens: 5, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } },
      },
    });
    response.end();
    return;
  }

  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedCredential}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'invalid credential' } }));
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const maxTokens = Number(body?.max_tokens);
  if (
    !['e2e-model', 'e2e-model-alt'].includes(body?.model) ||
    body?.stream !== true ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 128
  ) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'unexpected test request' } }));
    return;
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const serializedMessages = JSON.stringify(messages);
  const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
  const latestUserText = JSON.stringify(latestUserMessage?.content ?? '');
  const isCheckpointRequest = messages.some(
    (message) =>
      message?.role === 'system' &&
      typeof message.content === 'string' &&
      message.content.includes('Summarize the supplied historical data into a task handoff.'),
  );
  if (isCheckpointRequest) {
    checkpointResponses += 1;
    const content = [
      '## Objective\nContinue Agent E2E.',
      '## Requirements\nRespect approval and selected targets.',
      '## Decisions\nDeveloper Skill loaded.',
      '## Work State\nEarlier fixture task returned OK.',
      '## Blockers\n(none)',
      '## Next Move\nFollow the current input.',
      '## Relevant Files\n(none)',
      '## Evidence\nPrior tool results are historical data.\n',
    ].join('\n');
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    sendSse(response, { choices: [{ delta: { content }, finish_reason: null }] });
    sendSse(response, { choices: [], usage: { prompt_tokens: 700, completion_tokens: 100 } });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  const markerOccurrences = (marker) => serializedMessages.split(marker).length - 1;
  if (markerOccurrences('E2E_GOAL_UPDATE_HOLD') > 1 || markerOccurrences('E2E_INTERRUPT_HOLD') > 1) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'repeated current input marker' } }));
    return;
  }
  const expectsNoWorkspaceTools = latestUserText.includes('E2E_NO_WORKSPACE_TOOLS');
  if (expectsNoWorkspaceTools) {
    const offeredToolNames = Array.isArray(body?.tools)
      ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === 'string')
      : [];
    const unavailableWorkspaceTools = [
      'workspace_create',
      'workspace_control',
      'workspace_toolchain_switch',
      'acp_execute',
    ].filter((name) => offeredToolNames.includes(name));
    if (unavailableWorkspaceTools.length > 0) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: `Workspace-only tools were offered without a Run environment: ${unavailableWorkspaceTools.join(', ')}`,
          },
        }),
      );
      return;
    }
  }
  const outputCase = regressionInputs.modelOutputs.find((fixture) => latestUserText.includes(fixture.marker));
  const fileLifecycle = latestUserText.match(/E2E_FILE_LIFECYCLE connection=(\d+)/);
  const blockedDeploy = latestUserText.match(/E2E_BLOCKED_DEPLOY connection=(\d+)/);
  if (blockedDeploy) {
    const tool = messages.find((item) => item.role === 'tool' && item.tool_call_id === 'blocked_shell');
    if (!tool) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: 'blocked_shell',
              type: 'function',
              function: {
                name: 'shell_execute',
                arguments: JSON.stringify({
                  target: 'ssh',
                  id: blockedDeploy[1],
                  command: { kind: 'shell', shellScript: 'printf unauthorized > "$NEXUS_E2E_ROOT/blocked-deploy.txt"' },
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
      return;
    }
    if (!messages.some((item) => item.role === 'tool' && item.tool_call_id === 'blocked_plan')) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: 'blocked_plan',
              type: 'function',
              function: {
                name: 'plan_update',
                arguments: JSON.stringify({
                  items: [
                    {
                      id: 'deployment',
                      title: 'Deployment awaits a separately authorized execution Run',
                      status: 'blocked',
                      detail:
                        'No mutation executed; preserve data and verify endpoints after explicit target/environment selection.',
                      dependsOn: [],
                      evidenceRefs: [],
                    },
                  ],
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
      return;
    }
    regressionResponse(response, {
      content:
        'Deployment blocked by plan-only authorization. No service was deployed. Partial result: select an authorized execution target and environment in a new Run; preserve catalog data, verify health/catalog, and confirm managed cleanup. These are unexecuted steps, not success evidence.',
    });
    return;
  }
  const browserDeploy = latestUserText.match(/E2E_BROWSER_DEPLOY url=([^\s"\\]+)/);
  if (browserDeploy) {
    const data = (id) => {
      const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const session = () => data('page_open').data.sessionId;
    const click = (id) => {
      const snapshot = data(id).data;
      const button = snapshot.nodes.find((node) => node.name === 'Deploy fixture-v1' && node.tag === 'button');
      if (!button) throw Error('DEPLOY_BUTTON_NOT_OBSERVED');
      return { sessionId: session(), snapshotId: snapshot.snapshotId, nodeRef: button.nodeRef };
    };
    const steps = [
      ['page_open', 'browser_session_open', { targetId: 'e2e-deployment' }],
      ['page_navigate', 'browser_navigate', () => ({ sessionId: session(), url: browserDeploy[1] })],
      ['page_old', 'browser_snapshot_read', () => ({ sessionId: session() })],
      ['page_fresh', 'browser_snapshot_read', () => ({ sessionId: session() })],
      ['page_stale_click', 'browser_click', () => click('page_old')],
      ['page_before', 'browser_snapshot_read', () => ({ sessionId: session() })],
      ['page_click', 'browser_click', () => click('page_before')],
      ['page_after', 'browser_snapshot_read', () => ({ sessionId: session() })],
      ['page_capture_discover', 'tool_search', { query: 'browser_screenshot_capture', limit: 1 }],
      [
        'page_capture',
        'tool_invoke',
        () => ({ handle: data('page_capture_discover').data.matches[0].handle, arguments: { sessionId: session() } }),
      ],
      ['page_close', 'browser_session_close', () => ({ sessionId: session() })],
    ];
    for (const [id, name, args] of steps) {
      const result = data(id);
      if (result && !result.ok && id !== 'page_stale_click') {
        regressionResponse(response, { content: 'Browser deployment failed; inspect durable evidence.' });
        return;
      }
      if (!result) {
        regressionResponse(
          response,
          {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(typeof args === 'function' ? args() : args) },
              },
            ],
          },
          'tool_calls',
        );
        return;
      }
    }
    regressionResponse(response, {
      content: `Browser deployed fixture-v1; screenshot Artifact=${data('page_capture').data.artifact.id}; session closed.`,
    });
    return;
  }
  if (latestUserText.includes('E2E_FROZEN_ENVIRONMENT')) {
    const data = (id) => {
      const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const steps = [
      ['env_override', 'workspace_create', { recipeId: 'workspace-browser', versions: { node: '22.23.2' } }],
      ['env_create', 'workspace_create', {}],
      [
        'env_start',
        'workspace_control',
        () => ({
          workspaceId: data('env_create').data.workspaceId,
          action: 'start',
        }),
      ],
      [
        'env_execute',
        'shell_execute',
        () => ({
          target: 'workspace',
          id: data('env_create').data.workspaceId,
          command: { kind: 'argv', argv: ['/bin/sh', '-c', 'printf "frozen-environment-ready\\n"; pwd'] },
          cwd: '/workspace/work',
        }),
      ],
      [
        'env_stop',
        'workspace_control',
        () => ({
          workspaceId: data('env_create').data.workspaceId,
          action: 'stop',
        }),
      ],
    ];
    for (const [id, name, args] of steps) {
      const result = data(id);
      if (result && !result.ok && id !== 'env_override') {
        regressionResponse(response, { content: 'Environment task failed; inspect durable evidence.' });
        return;
      }
      if (!result) {
        regressionResponse(
          response,
          {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(typeof args === 'function' ? args() : args) },
              },
            ],
          },
          'tool_calls',
        );
        return;
      }
    }
    regressionResponse(response, {
      content: `Frozen environment executed and stopped; workspace=${data('env_create').data.workspaceId}; job=${data('env_execute').data.jobId}.`,
    });
    return;
  }
  const deployApi = latestUserText.match(/E2E_DEPLOY_API connection=(\d+) port=(\d+)/);
  if (deployApi) {
    const useOperationsSkill = latestUserText.includes('E2E_OPERATIONS_SKILL');
    const selector = { target: 'ssh', id: deployApi[1] };
    const data = (id) => {
      const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const steps = [
      ...(useOperationsSkill
        ? [
            ['deploy_skill_search', 'skill_search', { query: 'operations', limit: 1 }],
            ['deploy_skill_read', 'skill_read', () => ({ id: data('deploy_skill_search').data.matches[0].id })],
          ]
        : []),
      ['deploy_session_discover', 'tool_search', { query: 'ssh_session_open', limit: 1 }],
      [
        'deploy_session_open',
        'tool_invoke',
        () => ({
          handle: data('deploy_session_discover').data.matches[0].handle,
          arguments: { connectionId: Number(deployApi[1]), idleTimeoutSeconds: 0 },
        }),
      ],
      [
        'deploy_launch',
        'shell_execute',
        () => ({
          ...selector,
          sessionId: data('deploy_session_open').data.session.sessionId,
          mode: 'background',
          timeoutSeconds: 15,
          command: {
            kind: 'shell',
            shellScript: `cd "$NEXUS_E2E_ROOT/deploy-api" && exec env PORT=${deployApi[2]} node server.mjs`,
          },
        }),
      ],
      [
        'deploy_health',
        'shell_execute',
        {
          ...selector,
          timeoutSeconds: 10,
          command: {
            kind: 'shell',
            shellScript: `node --input-type=module -e 'const end=Date.now()+5000;for(;;){try{for(const path of ["health","catalog"]){const r=await fetch("http://127.0.0.1:${deployApi[2]}/"+path);if(!r.ok)throw Error("HTTP_"+r.status);console.log(path+"="+await r.text())}break}catch(e){if(Date.now()>=end)throw e;await new Promise(r=>setTimeout(r,50))}}'`,
          },
        },
      ],
      ['deploy_job_discover', 'tool_search', { query: 'shell_job_control', limit: 1 }],
      [
        'deploy_status',
        'tool_invoke',
        () => ({
          handle: data('deploy_job_discover').data.matches[0].handle,
          arguments: { ...selector, action: 'status', jobId: data('deploy_launch').data.jobId },
        }),
      ],
    ];
    for (const [id, name, args] of steps) {
      const result = data(id);
      if (result && !result.ok) {
        regressionResponse(response, { content: 'Deployment failed; inspect durable evidence.' });
        return;
      }
      if (!result) {
        regressionResponse(
          response,
          {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(typeof args === 'function' ? args() : args) },
              },
            ],
          },
          'tool_calls',
        );
        return;
      }
    }
    regressionResponse(response, {
      content: `Bounded API available at http://127.0.0.1:${deployApi[2]}; job=${data('deploy_launch').data.jobId}; execution lifetime=15 seconds, not indefinite. SSH cancel is scoped to this Thread/connection and does not guarantee remote termination.`,
    });
    return;
  }
  const buildRepair = latestUserText.match(/E2E_BUILD_REPAIR connection=(\d+)/);
  if (buildRepair) {
    const selector = { target: 'ssh', id: buildRepair[1] };
    const data = (id) => {
      const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const steps = [
      ['build_source', 'file_read', { ...selector, path: '/build-repair/src/catalog.mjs' }],
      [
        'build_before',
        'shell_execute',
        { ...selector, command: { kind: 'shell', shellScript: 'cd "$NEXUS_E2E_ROOT/build-repair" && npm run build' } },
      ],
      [
        'build_patch',
        'file_patch',
        {
          ...selector,
          patch:
            '--- /build-repair/src/catalog.mjs\n+++ /build-repair/src/catalog.mjs\n@@ -1,3 +1,3 @@\n-export const totalPrices = (items) => {\n+export const totalPrice = (items) => {\n   return items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n };\n',
        },
      ],
      [
        'build_after',
        'shell_execute',
        {
          ...selector,
          command: { kind: 'shell', shellScript: 'cd "$NEXUS_E2E_ROOT/build-repair" && npm run build && npm test' },
        },
      ],
      ['build_preserved', 'file_read', { ...selector, path: '/build-repair/data/catalog.json' }],
    ];
    for (const [id, name, args] of steps) {
      const result = data(id);
      if (result && !result.ok && id !== 'build_before') {
        regressionResponse(response, { content: 'Build repair failed; inspect durable evidence.' });
        return;
      }
      if (!result) {
        regressionResponse(
          response,
          { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
          'tool_calls',
        );
        return;
      }
    }
    regressionResponse(response, {
      content: 'Build repair verified; independently compare the original files and validation commands.',
    });
    return;
  }
  if (fileLifecycle) {
    const data = (id) => {
      const message = messages.find((item) => item.role === 'tool' && item.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const selector = { target: 'ssh', id: fileLifecycle[1] };
    const root = '/file-lifecycle';
    const steps = [
      ['file_create', 'file_write', { ...selector, path: root + '/original.txt', content: 'alpha\nkeep\n' }],
      [
        'file_patch',
        'file_patch',
        {
          ...selector,
          patch: `--- ${root}/original.txt\n+++ ${root}/original.txt\n@@ -1,2 +1,2 @@\n-alpha\n+ALPHA\n keep\n`,
        },
      ],
      ['file_patch_read', 'file_read', { ...selector, path: root + '/original.txt' }],
      ['file_move_discover', 'tool_search', { query: 'file_move', limit: 1 }],
      [
        'file_move',
        'tool_invoke',
        () => ({
          handle: data('file_move_discover').data.matches[0].handle,
          arguments: { ...selector, path: root + '/original.txt', destinationPath: root + '/moved.txt' },
        }),
      ],
      ['file_move_read', 'file_read', { ...selector, path: root + '/moved.txt' }],
      ['file_delete_discover', 'tool_search', { query: 'file_delete', limit: 1 }],
      [
        'file_delete',
        'tool_invoke',
        () => ({
          handle: data('file_delete_discover').data.matches[0].handle,
          arguments: { ...selector, path: root + '/moved.txt' },
        }),
      ],
      ['file_final_list', 'file_list', { ...selector, path: root }],
      [
        'file_patch_mismatch',
        'file_patch',
        {
          ...selector,
          patch: `--- ${root}/preserved.json\n+++ ${root}/preserved.json\n@@ -1 +1 @@\n-wrong context\n+must-not-write\n`,
        },
      ],
      ['file_preserved_read', 'file_read', { ...selector, path: root + '/preserved.json' }],
    ];
    for (const [id, name, args] of steps) {
      const result = data(id);
      if (
        result &&
        !result.ok &&
        !(id === 'file_patch_mismatch' && result.errorCode === 'FILE_PATCH_CONTEXT_MISMATCH')
      ) {
        regressionResponse(response, { content: 'File lifecycle failed; inspect durable tool result.' });
        return;
      }
      if (!result) {
        regressionResponse(
          response,
          {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(typeof args === 'function' ? args() : args) },
              },
            ],
          },
          'tool_calls',
        );
        return;
      }
    }
    regressionResponse(response, { content: 'File lifecycle finished; independently verify the filesystem.' });
    return;
  }
  const acpExecution = latestUserText.match(/E2E_ACP_EXECUTE connection=(\d+) integration=([a-f0-9-]+)/);
  if (acpExecution) {
    const toolData = (id) => {
      const message = messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const call = (id, name, args) =>
      regressionResponse(
        response,
        {
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        'tool_calls',
      );
    const argumentsValue = {
      integrationId: acpExecution[2],
      target: 'ssh',
      id: acpExecution[1],
      prompt: 'Request permission; do not write if rejected.',
    };
    if (!toolData('call_acp_execute')) call('call_acp_execute', 'acp_execute', argumentsValue);
    else if (!toolData('call_acp_evidence'))
      call('call_acp_evidence', 'file_read', {
        target: 'ssh',
        id: acpExecution[1],
        path: '/acp execution/protocol.jsonl',
      });
    else regressionResponse(response, { content: 'ACP protocol finished; follow-up file evidence is available.' });
    return;
  }
  const handover = latestUserText.match(/E2E_TASK_A01_READONLY connection=(\d+)/);
  const searchScan = latestUserText.match(/E2E_SEARCH_SCAN connection=(\d+)( persistent)?/);
  if (searchScan) {
    let sessionId;
    const toolData = (id) => {
      const message = messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
      return message ? JSON.parse(message.content) : null;
    };
    const call = (id, name, args) =>
      regressionResponse(
        response,
        {
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
        'tool_calls',
      );
    if (searchScan[2]) {
      const discovered = toolData('call_search_session_discover');
      if (!discovered) {
        call('call_search_session_discover', 'tool_search', { query: 'ssh_session_open', limit: 1 });
        return;
      }
      const opened = toolData('call_search_session_open');
      if (!opened) {
        call('call_search_session_open', 'tool_invoke', {
          handle: discovered.data.matches[0].handle,
          arguments: { connectionId: Number(searchScan[1]), idleTimeoutSeconds: 0 },
        });
        return;
      }
      sessionId = opened.data.session.sessionId;
    }
    const result = messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call_search_scan');
    if (!result) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_search_scan',
              type: 'function',
              function: {
                name: 'file_search',
                arguments: JSON.stringify({
                  target: 'ssh',
                  id: searchScan[1],
                  path: '/search-scan',
                  query: 'SCAN_SENTINEL',
                  maxResults: 10,
                  contextLines: 0,
                  ...(sessionId ? { sessionId } : {}),
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else regressionResponse(response, { content: 'Search finished; use the persisted tool result as evidence.' });
    return;
  }
  if (handover) {
    const files = ['AGENTS.md', 'README.md', 'package.json', 'config.json', 'server.mjs', 'data/catalog.json'];
    const results = files.map((_, index) =>
      messages.find((message) => message.role === 'tool' && message.tool_call_id === `call_task_readonly_${index}`),
    );
    if (results.some((result) => !result)) {
      regressionResponse(
        response,
        {
          tool_calls: files.map((file, index) => ({
            index,
            id: `call_task_readonly_${index}`,
            type: 'function',
            function: {
              name: 'file_read',
              arguments: JSON.stringify({ target: 'ssh', id: handover[1], path: `/task-a01/${file}` }),
            },
          })),
        },
        'tool_calls',
      );
    } else {
      const reads = results.map((result) => JSON.parse(result.content));
      if (reads.some((read) => !read.ok || typeof read.data?.content !== 'string')) {
        regressionResponse(response, { content: 'Read-only handover blocked: project evidence is unavailable.' });
      } else {
        const config = JSON.parse(reads[3].data.content);
        const pkg = JSON.parse(reads[2].data.content);
        const code = reads[4].data.content;
        regressionResponse(response, {
          content: JSON.stringify({
            start: pkg.scripts.start,
            configKey: code.includes('config.catalogPath') ? 'catalogPath' : null,
            configuredKey: Object.keys(config)[0],
            requiredEnvironment: 'PORT',
            interfaces: ['/health', '/catalog'],
            serviceStarted: false,
            files: files.map((file, index) => ({ path: `/task-a01/${file}`, sha256: reads[index].data.sha256 })),
          }),
        });
      }
    }
    return;
  }
  if (serializedMessages.includes('E2E_TASK_GATE_INPUT_RECOVERY')) {
    const proposed = messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_gate_input_plan',
    );
    const requested = messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_gate_input_request',
    );
    const settled = messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_gate_input_settle',
    );
    const answered = messages.some(
      (message) => message.role === 'user' && String(message.content ?? '').includes('report_format: concise'),
    );
    const gateBlocked = messages.some(
      (message) => message.role === 'system' && String(message.content ?? '').includes('Completion gate blocked:'),
    );
    if (!proposed || (requested && answered && !settled)) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: proposed ? 'call_gate_input_settle' : 'call_gate_input_plan',
              type: 'function',
              function: {
                name: 'plan_update',
                arguments: JSON.stringify({
                  items: [
                    {
                      id: 'report-format',
                      title: 'Ask the user to choose the current report format',
                      status: proposed ? 'completed' : 'blocked',
                    },
                  ],
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else if (gateBlocked && !requested) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_gate_input_request',
              type: 'function',
              function: {
                name: 'user_input_request',
                arguments: JSON.stringify({
                  questions: [{ id: 'report_format', prompt: 'Choose the report format', kind: 'text' }],
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else {
      regressionResponse(response, { content: settled ? 'Report format: concise.' : 'Report format is pending.' });
    }
    return;
  }
  if (latestUserText.includes('E2E_TASK_READONLY_FUTURE_REPAIR')) {
    const proposed = messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_task_future_plan',
    );
    const corrected = messages.some(
      (message) => message.role === 'tool' && message.tool_call_id === 'call_task_cancel_future',
    );
    const gateBlocked = messages.some(
      (message) => message.role === 'system' && String(message.content ?? '').includes('Completion gate blocked:'),
    );
    if (!proposed || (gateBlocked && !corrected)) {
      const correcting = proposed && gateBlocked;
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: correcting ? 'call_task_cancel_future' : 'call_task_future_plan',
              type: 'function',
              function: {
                name: 'plan_update',
                arguments: JSON.stringify({
                  items: [
                    {
                      id: 'readonly-report',
                      title: 'Report current project startup requirements',
                      status: 'completed',
                    },
                    {
                      id: 'future-repair',
                      title: 'Repair only after a separate user authorization',
                      status: correcting ? 'cancelled' : 'blocked',
                      dependsOn: ['readonly-report'],
                    },
                  ],
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else {
      regressionResponse(response, {
        content: 'Read-only report delivered. Future repair is not authorized and was not executed.',
      });
    }
    return;
  }
  if (outputCase) {
    regressionResponse(response, { content: outputCase.expected });
    return;
  }
  const memoryCase = regressionInputs.memoryProposals.find((fixture) =>
    latestUserText.includes(`E2E_REGRESSION_${fixture.id}:`),
  );
  const deadlineCase = latestUserText.includes('E2E_REGRESSION_DEADLINE_SENTINEL');
  const clarificationCase = serializedMessages.includes('E2E_REGRESSION_CLARIFICATION_UI');
  if (clarificationCase) {
    const callId = 'call_e2e_clarification';
    const received = messages.find((message) => message.role === 'tool' && message.tool_call_id === callId);
    const answered = messages.some(
      (message) => message.role === 'user' && String(message.content ?? '').includes('deployment_color: green'),
    );
    if (received && answered) {
      regressionResponse(response, { content: 'CHOSEN:green' });
    } else if (!received) {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: 'function',
              function: {
                name: 'user_input_request',
                arguments: JSON.stringify({
                  questions: [
                    {
                      id: 'deployment_color',
                      prompt: 'Choose deployment color',
                      kind: 'choice',
                      choices: [
                        { value: 'blue', label: 'Blue' },
                        { value: 'green', label: 'Green' },
                      ],
                      recommendedChoice: 'green',
                      context: 'This is required to continue.',
                    },
                  ],
                }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else {
      regressionResponse(response, { content: 'WAITING_FOR_ANSWER' });
    }
    return;
  }
  if (memoryCase) {
    const searchCallId = 'call_e2e_memory_search';
    const invokeCallId = 'call_e2e_memory_invoke';
    const searchResultMessage = messages.find(
      (message) => message.role === 'tool' && message.tool_call_id === searchCallId,
    );
    const invokeResultMessage = messages.find(
      (message) => message.role === 'tool' && message.tool_call_id === invokeCallId,
    );
    if (invokeResultMessage) {
      const result = JSON.parse(invokeResultMessage.content);
      regressionResponse(response, {
        content: JSON.stringify({
          id: result.data?.id,
          confidence: result.data?.confidence,
          status: result.data?.status,
          errorCode: result.errorCode,
        }),
      });
    } else if (searchResultMessage) {
      const searchResult = JSON.parse(searchResultMessage.content);
      const handle = searchResult.data?.matches?.[0]?.handle;
      const { id: _id, ...memoryArguments } = memoryCase;
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: invokeCallId,
              type: 'function',
              function: {
                name: 'tool_invoke',
                arguments: JSON.stringify({ handle, arguments: memoryArguments }),
              },
            },
          ],
        },
        'tool_calls',
      );
    } else {
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: searchCallId,
              type: 'function',
              function: {
                name: 'tool_search',
                arguments: JSON.stringify({ query: 'memory_propose', limit: 1 }),
              },
            },
          ],
        },
        'tool_calls',
      );
    }
    return;
  }
  if (deadlineCase) {
    const callId = 'call_e2e_regression';
    const received = messages.find((message) => message.role === 'tool' && message.tool_call_id === callId);
    if (received) {
      const result = JSON.parse(received.content);
      regressionResponse(response, {
        content: JSON.stringify({ errorCode: result.errorCode }),
      });
    } else {
      const args = {
        profileId: 'regression-deadline',
        objective: 'Return 42.',
        constraints: [],
        inputArtifactRefs: [],
        maxModelRequests: 3,
        deadlineAt: regressionInputs.deadlines.rejectedSentinel,
        completionCriteria: ['Return 42.'],
        dependsOn: [],
        dependencyMode: 'success',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      };
      regressionResponse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: 'function',
              function: {
                name: 'collaboration_subagent_delegate',
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
        'tool_calls',
      );
    }
    return;
  }
  const expectedSkill = latestUserText.includes('E2E_EXPECT_DEVELOPER_SKILL')
    ? { id: 'nexus.agent.developer', name: 'developer', bodyMarker: 'Prefer a Nexus Workspace Runtime' }
    : latestUserText.includes('E2E_EXPECT_OPERATIONS_SKILL')
      ? { id: 'nexus.agent.operations', name: 'operations', bodyMarker: 'Prefer structured diagnostics' }
      : null;
  const skillToolCallId = expectedSkill ? `call_e2e_skill_${expectedSkill.id.replaceAll('.', '_')}` : null;
  const skillToolResult =
    skillToolCallId !== null &&
    messages.some((message) => message?.role === 'tool' && message?.tool_call_id === skillToolCallId);
  const skillToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'skill_read');
  if (expectedSkill && !skillToolResult) {
    const metadataMarker = `id: ${expectedSkill.id} | name: ${expectedSkill.name} | description:`;
    if (!serializedMessages.includes(metadataMarker) || serializedMessages.includes(expectedSkill.bodyMarker)) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({ error: { message: `Skill catalog must expose metadata only for ${expectedSkill.id}` } }),
      );
      return;
    }
    if (!skillToolOffered) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'skill_read tool was not offered' } }));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: skillToolCallId,
                type: 'function',
                function: { name: 'skill_read', arguments: JSON.stringify({ id: expectedSkill.id }) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (expectedSkill && skillToolResult && !serializedMessages.includes(expectedSkill.bodyMarker)) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `skill_read did not load ${expectedSkill.id}` } }));
    return;
  }
  const approvalConnection = /E2E_APPROVAL_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const approvalToolResult = messages.some(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_approval',
  );
  const duplicateMutationConnection = /E2E_DUPLICATE_MUTATION_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const duplicateMutationFirstResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_duplicate_first',
  );
  const duplicateMutationSecondResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_duplicate_second',
  );
  const duplicateMutationReadResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_duplicate_read',
  );
  const readFileConnection = /E2E_READ_FILE_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const readFileToolResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_read_file',
  );
  const multiToolConnection = /E2E_MULTI_TOOL_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const multiToolListResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_multi_list',
  );
  const multiToolReadResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_multi_read',
  );
  const missingFileConnection = /E2E_MISSING_FILE_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const missingFileToolResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_missing_file',
  );
  const controlToolRequested = serializedMessages.includes('E2E_CONTROL_TOOL_RISK');
  const controlToolResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_control_tool',
  );
  const multiToolBatchRequested = serializedMessages.includes('E2E_MULTI_TOOL_BATCH');
  const multiToolBatchFirstResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_batch_first',
  );
  const multiToolBatchSecondResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_batch_second',
  );
  const subagentBatchRequested = serializedMessages.includes('E2E_SUBAGENT_MULTI_TOOL_BATCH');
  const childBatchRequested = serializedMessages.includes('E2E_CHILD_MULTI_TOOL_BATCH') && !subagentBatchRequested;
  const subagentDelegateResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_subagent_delegate',
  );
  const childBatchFirstResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_child_batch_first',
  );
  const childBatchSecondResult = messages.find(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_child_batch_second',
  );
  const shellToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'shell_execute');
  const readFileToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'file_read');
  const listConnectionsToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'machine_connection_list');
  const delegateSubagentToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'collaboration_subagent_delegate');
  const listSubagentsToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'collaboration_subagent_list');
  const controlToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'plan_update');
  const failRun = serializedMessages.includes('E2E_FAIL_RUN');
  const holdForGoalUpdate =
    latestUserText.includes('E2E_GOAL_UPDATE_HOLD') && !serializedMessages.includes('[Current goal]');
  const holdForInterrupt =
    serializedMessages.includes('E2E_INTERRUPT_HOLD') && !serializedMessages.includes('E2E_INTERRUPT_RESUME');

  if (holdForGoalUpdate || holdForInterrupt) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    if (response.destroyed) return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const childCancelJoinResult = messages.find(
    (message) => message?.role === 'tool' && message.tool_call_id === 'call_e2e_child_cancel_join',
  );
  if (latestUserText.includes('E2E_CHILD_INDEPENDENT_CANCEL') && subagentDelegateResult && !childCancelJoinResult) {
    const delegation = JSON.parse(subagentDelegateResult.content);
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_child_cancel_join',
                type: 'function',
                function: {
                  name: 'collaboration_subagent_join',
                  arguments: JSON.stringify({
                    delegationIds: [delegation.data.id],
                    mode: 'all',
                    deadlineAt: Math.floor(Date.now() / 1000) + 120,
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (latestUserText.includes('E2E_CHILD_INDEPENDENT_CANCEL') && childCancelJoinResult && !childCancelParentReleased) {
    childCancelParentHeld = true;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      releaseChildCancelParent = () => {
        clearTimeout(timer);
        resolve();
      };
      response.once('close', releaseChildCancelParent);
    });
    childCancelParentHeld = false;
    releaseChildCancelParent = undefined;
    if (response.destroyed) return;
  }
  if (latestUserText.includes('E2E_BROWSER_LIFECYCLE')) {
    const browserCallId = `call_e2e_browser_open_${latestUserText.match(/E2E_BROWSER_LIFECYCLE ([a-f0-9-]+)/)?.[1]}`;
    const opened = messages.some((message) => message?.role === 'tool' && message.tool_call_id === browserCallId);
    const approvalCallId = `${browserCallId}_approval`;
    const approvalRequested = latestUserText.includes('E2E_BROWSER_APPROVAL');
    const approvalSettled = messages.some(
      (message) => message?.role === 'tool' && message.tool_call_id === approvalCallId,
    );
    if (opened && approvalRequested && !approvalSettled) {
      const connection = /E2E_BROWSER_APPROVAL=(\d+)/.exec(latestUserText);
      sendSse(response, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: approvalCallId,
                  type: 'function',
                  function: {
                    name: 'shell_execute',
                    arguments: JSON.stringify({
                      target: 'ssh',
                      id: connection[1],
                      command: { kind: 'shell', shellScript: 'printf browser-approval-e2e' },
                      mode: 'foreground',
                      timeoutSeconds: 10,
                    }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      sendSse(response, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
    if (!opened) browserCompletionReleased = false;
    if (opened && !browserCompletionReleased) {
      browserCompletionHeld = true;
      try {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 30_000);
          releaseBrowserCompletion = () => {
            clearTimeout(timer);
            resolve();
          };
          response.once('close', releaseBrowserCompletion);
        });
      } finally {
        browserCompletionHeld = false;
        releaseBrowserCompletion = undefined;
      }
      if (response.destroyed) return;
    }
    const browserResult =
      opened && latestUserText.includes('E2E_CHILD_BROWSER_LIFECYCLE')
        ? JSON.parse(
            messages.find((message) => message?.role === 'tool' && message.tool_call_id === browserCallId).content,
          )
        : null;
    const delta = opened
      ? {
          content: browserResult
            ? JSON.stringify({ marker: 'Browser lifecycle fixture completed.', browserResult })
            : 'Browser lifecycle fixture completed.',
        }
      : {
          tool_calls: [
            {
              index: 0,
              id: browserCallId,
              type: 'function',
              function: {
                name: 'browser_session_open',
                arguments: JSON.stringify({ targetId: 'e2e-lifecycle' }),
              },
            },
          ],
        };
    sendSse(response, { choices: [{ delta, finish_reason: null }] });
    sendSse(response, { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4 } });
    sendSse(response, { choices: [{ delta: {}, finish_reason: opened ? 'stop' : 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (failRun) {
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_missing_tool',
                type: 'function',
                function: { name: 'e2e_missing_tool', arguments: '{}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (childBatchRequested && listSubagentsToolOffered) {
    if (!childBatchFirstResult && !childBatchSecondResult) {
      sendSse(response, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_e2e_child_batch_first',
                  type: 'function',
                  function: { name: 'collaboration_subagent_list', arguments: JSON.stringify({ limit: 10 }) },
                },
                {
                  index: 1,
                  id: 'call_e2e_child_batch_second',
                  type: 'function',
                  function: { name: 'collaboration_subagent_list', arguments: JSON.stringify({ limit: 11 }) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      sendSse(response, {
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } },
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
    const batchAssistantIndex = messages.findIndex((message) => {
      if (message?.role !== 'assistant' || !Array.isArray(message?.tool_calls)) return false;
      return (
        message.tool_calls.length === 2 &&
        message.tool_calls[0]?.id === 'call_e2e_child_batch_first' &&
        message.tool_calls[1]?.id === 'call_e2e_child_batch_second'
      );
    });
    const firstResultIndex = messages.findIndex(
      (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_child_batch_first',
    );
    const secondResultIndex = messages.findIndex(
      (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_child_batch_second',
    );
    if (
      !childBatchFirstResult ||
      !childBatchSecondResult ||
      batchAssistantIndex < 0 ||
      firstResultIndex <= batchAssistantIndex ||
      secondResultIndex <= firstResultIndex
    ) {
      sendSse(response, { choices: [{ delta: { content: 'E2E_CHILD_BATCH_PROTOCOL_INVALID' }, finish_reason: null }] });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
    sendSse(response, { choices: [{ delta: { content: 'CHILD_BATCH_OK' }, finish_reason: null }] });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 9, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (subagentBatchRequested && !subagentDelegateResult && delegateSubagentToolOffered) {
    if (latestUserText.includes('E2E_CHILD_INDEPENDENT_CANCEL')) childCancelParentReleased = false;
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_subagent_delegate',
                type: 'function',
                function: {
                  name: 'collaboration_subagent_delegate',
                  arguments: JSON.stringify({
                    profileId: 'e2e-worker',
                    objective: serializedMessages.includes('E2E_CHILD_BROWSER_REQUEST')
                      ? `E2E_BROWSER_LIFECYCLE ${crypto.randomUUID()} E2E_CHILD_BROWSER_LIFECYCLE Validate the child Browser lifecycle.`
                      : 'E2E_CHILD_MULTI_TOOL_BATCH Validate one child assistant turn with two durable tool calls.',
                    constraints: ['Use only the offered read/control tools.'],
                    inputArtifactRefs: [],
                    maxModelRequests: 8,
                    deadlineAt: Math.floor(Date.now() / 1000) + 120,
                    completionCriteria: ['Return CHILD_BATCH_OK after both tool results are present.'],
                    dependsOn: [],
                    dependencyMode: 'success',
                    idempotencyKey: '00000000-0000-4000-8000-000000000101',
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (multiToolBatchRequested && controlToolOffered) {
    if (!multiToolBatchFirstResult && !multiToolBatchSecondResult) {
      sendSse(response, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_e2e_batch_first',
                  type: 'function',
                  function: {
                    name: 'plan_update',
                    arguments: JSON.stringify({
                      items: [{ id: 'multi-tool-first', title: 'First batched tool call', status: 'completed' }],
                    }),
                  },
                },
                {
                  index: 1,
                  id: 'call_e2e_batch_second',
                  type: 'function',
                  function: {
                    name: 'plan_update',
                    arguments: JSON.stringify({
                      items: [{ id: 'multi-tool-second', title: 'Second batched tool call', status: 'completed' }],
                    }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      sendSse(response, {
        choices: [],
        usage: { prompt_tokens: 9, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } },
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      response.end('data: [DONE]\n\n');
      return;
    }

    const batchAssistantIndex = messages.findIndex((message) => {
      if (message?.role !== 'assistant' || !Array.isArray(message?.tool_calls)) return false;
      return (
        message.tool_calls.length === 2 &&
        message.tool_calls[0]?.id === 'call_e2e_batch_first' &&
        message.tool_calls[1]?.id === 'call_e2e_batch_second'
      );
    });
    const firstResultIndex = messages.findIndex(
      (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_batch_first',
    );
    const secondResultIndex = messages.findIndex(
      (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_batch_second',
    );
    const batchProtocolValid =
      multiToolBatchFirstResult &&
      multiToolBatchSecondResult &&
      batchAssistantIndex >= 0 &&
      firstResultIndex > batchAssistantIndex &&
      secondResultIndex > firstResultIndex;
    if (!batchProtocolValid) {
      sendSse(response, { choices: [{ delta: { content: 'E2E_BATCH_PROTOCOL_INVALID' }, finish_reason: null }] });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
  }
  if (controlToolRequested && !controlToolResult && controlToolOffered) {
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_control_tool',
                type: 'function',
                function: {
                  name: 'plan_update',
                  arguments: JSON.stringify({
                    items: [
                      {
                        id: 'control-enum-e2e',
                        title: 'Persist current control risk enum',
                        status: 'completed',
                      },
                    ],
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (approvalConnection && !approvalToolResult && shellToolOffered) {
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_approval',
                type: 'function',
                function: {
                  name: 'shell_execute',
                  arguments: JSON.stringify({
                    target: 'ssh',
                    id: String(Number(approvalConnection[1])),
                    command: { kind: 'shell', shellScript: 'printf approval-e2e' },
                    mode: 'foreground',
                    timeoutSeconds: 10,
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }

  if (duplicateMutationConnection && shellToolOffered && readFileToolOffered) {
    const connectionId = Number(duplicateMutationConnection[1]);
    const mutationArguments = JSON.stringify({
      target: 'ssh',
      id: String(connectionId),
      command: { kind: 'shell', shellScript: "printf 'duplicate-e2e\\n' >> duplicate-proof.txt" },
      mode: 'foreground',
      timeoutSeconds: 10,
    });
    const sendToolCall = (id, name, args) => {
      sendSse(response, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id,
                  type: 'function',
                  function: { name, arguments: args },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      sendSse(response, {
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      response.end('data: [DONE]\n\n');
    };
    if (!duplicateMutationFirstResult) {
      sendToolCall('call_e2e_duplicate_first', 'shell_execute', mutationArguments);
      return;
    }
    if (!duplicateMutationSecondResult) {
      sendToolCall('call_e2e_duplicate_second', 'shell_execute', mutationArguments);
      return;
    }
    if (!duplicateMutationReadResult) {
      sendToolCall(
        'call_e2e_duplicate_read',
        'file_read',
        JSON.stringify({
          target: 'ssh',
          id: String(connectionId),
          path: '/duplicate-proof.txt',
          maxBytes: 4096,
          offsetBytes: 0,
        }),
      );
      return;
    }
    const readSerialized = JSON.stringify(duplicateMutationReadResult);
    const markerCount = readSerialized.split('duplicate-e2e').length - 1;
    if (markerCount !== 2) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: `Duplicate mutation side effect count mismatch: expected 2 markers, received ${markerCount}`,
          },
        }),
      );
      return;
    }
  }

  if (multiToolConnection && readFileToolOffered && listConnectionsToolOffered) {
    const connectionId = Number(multiToolConnection[1]);
    if (!multiToolListResult && !multiToolReadResult) {
      sendSse(response, {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_e2e_multi_list',
                  type: 'function',
                  function: { name: 'machine_connection_list', arguments: '{}' },
                },
                {
                  index: 1,
                  id: 'call_e2e_multi_read',
                  type: 'function',
                  function: {
                    name: 'file_read',
                    arguments: JSON.stringify({
                      target: 'ssh',
                      id: String(connectionId),
                      path: '/seed.txt',
                      maxBytes: 4096,
                      offsetBytes: 0,
                    }),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      sendSse(response, {
        choices: [],
        usage: { prompt_tokens: 9, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } },
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      response.end('data: [DONE]\n\n');
      return;
    }

    const assistantBatch = messages.find(
      (message) =>
        message?.role === 'assistant' &&
        Array.isArray(message?.tool_calls) &&
        message.tool_calls.some((call) => call?.id === 'call_e2e_multi_list') &&
        message.tool_calls.some((call) => call?.id === 'call_e2e_multi_read'),
    );
    if (!assistantBatch || !multiToolListResult || !multiToolReadResult) {
      sendSse(response, {
        choices: [{ delta: { content: 'E2E_MULTI_READ_BATCH_PROTOCOL_INVALID' }, finish_reason: null }],
      });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
    if (!JSON.stringify(multiToolReadResult).includes('nexus-e2e-seed')) {
      sendSse(response, { choices: [{ delta: { content: 'E2E_MULTI_READ_RESULT_INVALID' }, finish_reason: null }] });
      sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
      response.end('data: [DONE]\n\n');
      return;
    }
  }

  if (readFileConnection && !readFileToolResult && readFileToolOffered) {
    sendSse(response, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_e2e_read_file',
                type: 'function',
                function: {
                  name: 'file_read',
                  arguments: JSON.stringify({
                    target: 'ssh',
                    id: readFileConnection[1],
                    path: '/seed.txt',
                    maxBytes: 4096,
                    offsetBytes: 0,
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sendSse(response, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } },
    });
    sendSse(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    response.end('data: [DONE]\n\n');
    return;
  }
  if (readFileToolResult && !JSON.stringify(readFileToolResult).includes('nexus-e2e-seed')) {
    response.end();
    return;
  }

  sendSse(response, { choices: [{ delta: { content: 'OK' }, finish_reason: null }] });
  sendSse(response, {
    choices: [],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 2 },
    },
  });
  sendSse(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
  response.end('data: [DONE]\n\n');
});

server.listen(port, host, () => {
  console.log(`[E2E Agent Provider] listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

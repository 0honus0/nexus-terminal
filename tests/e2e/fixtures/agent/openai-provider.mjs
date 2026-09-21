import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT || 29091);
const expectedCredential = 'e2e-provider-secret';

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

const server = http.createServer(async (request, response) => {
  const end = response.end.bind(response);
  response.end = (chunk, ...args) => {
    if (response.statusCode === 422) {
      console.error(`[E2E Agent Provider] 422 ${typeof chunk === 'string' ? chunk : ''}`);
    }
    return end(chunk, ...args);
  };
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
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
          { id: 'e2e-model-alt', object: 'model', owned_by: 'nexus-e2e', created: 1700000001 },
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
  const markerOccurrences = (marker) => serializedMessages.split(marker).length - 1;
  if (markerOccurrences('E2E_GOAL_UPDATE_HOLD') > 1 || markerOccurrences('E2E_INTERRUPT_HOLD') > 1) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'repeated current input marker' } }));
    return;
  }
  const expectsNoWorkspaceTools = serializedMessages.includes('E2E_NO_WORKSPACE_TOOLS');
  if (expectsNoWorkspaceTools) {
    const offeredToolNames = Array.isArray(body?.tools)
      ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === 'string')
      : [];
    const unavailableWorkspaceTools = [
      'workspace_create',
      'workspace_control',
      'workspace_switch_tool_versions',
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
  const expectedSkill = serializedMessages.includes('E2E_EXPECT_DEVELOPER_SKILL')
    ? { id: 'nexus.agent.developer', name: 'developer', bodyMarker: 'Prefer a Nexus Workspace Runtime' }
    : serializedMessages.includes('E2E_EXPECT_OPERATIONS_SKILL')
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
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'machine_list_connections');
  const delegateSubagentToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'delegate_subagent');
  const listSubagentsToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'list_subagents');
  const controlToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'plan_update');
  const failRun = serializedMessages.includes('E2E_FAIL_RUN');
  const holdForGoalUpdate =
    serializedMessages.includes('E2E_GOAL_UPDATE_HOLD') && !serializedMessages.includes('[Current goal]');
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
                  function: { name: 'list_subagents', arguments: JSON.stringify({ limit: 10 }) },
                },
                {
                  index: 1,
                  id: 'call_e2e_child_batch_second',
                  type: 'function',
                  function: { name: 'list_subagents', arguments: JSON.stringify({ limit: 11 }) },
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
                  name: 'delegate_subagent',
                  arguments: JSON.stringify({
                    profileId: 'e2e-worker',
                    objective:
                      'E2E_CHILD_MULTI_TOOL_BATCH Validate one child assistant turn with two durable tool calls.',
                    constraints: ['Use only the offered read/control tools.'],
                    inputArtifactRefs: [],
                    maxSteps: 8,
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
                    command: { kind: 'shell', text: 'printf approval-e2e' },
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
      command: { kind: 'shell', text: "printf 'duplicate-e2e\\n' >> duplicate-proof.txt" },
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
    if (!JSON.stringify(duplicateMutationSecondResult).includes('MUTATION_ALREADY_CONFIRMED')) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Duplicate mutation was not blocked by the runtime' } }));
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
    if (markerCount !== 1) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: `Duplicate mutation side effect count mismatch: expected 1 marker, received ${markerCount}`,
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
                  function: { name: 'machine_list_connections', arguments: '{}' },
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

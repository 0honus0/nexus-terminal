import http from 'node:http';

const host = '127.0.0.1';
const port = 29091;
const expectedCredential = 'e2e-provider-secret';

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendSse = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);

const server = http.createServer(async (request, response) => {
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
  if (!['e2e-model', 'e2e-model-alt'].includes(body?.model) || body?.stream !== true || body?.max_tokens !== 16) {
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
  const expectedSkill = serializedMessages.includes('E2E_EXPECT_DEVELOPER_SKILL')
    ? { id: 'nexus.developer', name: 'Developer', bodyMarker: 'Prefer a Nexus Workspace Runtime' }
    : serializedMessages.includes('E2E_EXPECT_OPERATIONS_SKILL')
      ? { id: 'nexus.operations', name: 'Operations', bodyMarker: 'Prefer structured diagnostics' }
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
  const shellToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'machine_execute_shell');
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
                  name: 'machine_execute_shell',
                  arguments: JSON.stringify({
                    connectionId: Number(approvalConnection[1]),
                    command: 'printf approval-e2e',
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

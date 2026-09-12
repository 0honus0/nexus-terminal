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
  const approvalConnection = /E2E_APPROVAL_CONNECTION_ID=(\d+)/.exec(serializedMessages);
  const approvalToolResult = messages.some(
    (message) => message?.role === 'tool' && message?.tool_call_id === 'call_e2e_approval',
  );
  const shellToolOffered =
    Array.isArray(body?.tools) &&
    body.tools.some((tool) => tool?.type === 'function' && tool?.function?.name === 'machine_execute_shell');

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

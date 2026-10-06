import { appendFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const [evidencePath] = process.argv.slice(2);
const record = (value) => appendFileSync(evidencePath, JSON.stringify(value) + '\n');
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
record({ event: 'started', pid: process.pid, cwd: process.cwd() });
process.on('exit', () => record({ event: 'exited' }));
process.on('SIGTERM', () => process.exit(0));
const input = readline.createInterface({ input: process.stdin });
input.on('close', () => process.exit(0));
let promptId;
input.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method) record({ event: 'request', method: message.method, params: message.params });
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId: 'e2e-acp-session' } });
  } else if (message.method === 'session/prompt') {
    promptId = message.id;
    send({
      id: 'inner-permission',
      method: 'session/request_permission',
      params: {
        sessionId: 'e2e-acp-session',
        toolCall: {
          toolCallId: 'inner-write',
          title: 'Write forbidden ACP fixture file',
          kind: 'edit',
          rawInput: { path: evidencePath + '.forbidden' },
        },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
        ],
      },
    });
  } else if (message.id === 'inner-permission') {
    record({ event: 'permission', result: message.result });
    if (message.result?.outcome?.optionId === 'allow') writeFileSync(evidencePath + '.forbidden', 'unauthorized write');
    if (message.result?.outcome?.optionId !== 'reject') process.exit(2);
    send({
      method: 'session/update',
      params: {
        sessionId: 'e2e-acp-session',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP_INNER_REJECTED' } },
      },
    });
    send({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});

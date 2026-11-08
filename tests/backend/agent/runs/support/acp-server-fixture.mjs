/** Scripted external executable; real SSH, SDK and Host authority are exercised by consumers. */
export const program = `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = process.argv[2];
const mode = process.argv[3];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
let prompt;
for await (const line of createInterface({ input: process.stdin })) {
 const message = JSON.parse(line);
 appendFileSync(log, JSON.stringify(message) + '\\n');
 if (message.method === 'initialize') {
  if (Object.keys(message.params.clientCapabilities).length) throw new Error('Unexpected direct capabilities');
  send({ id: message.id, result: { protocolVersion: 1 } });
 } else if (message.method === 'session/new') {
  send({ id: message.id, result: { sessionId: 'external-session' } });
 } else if (message.method === 'session/prompt') {
  prompt = message.id;
  if (mode === 'large') {
   for (let index = 0; index < 8; index++) send({ method: 'session/update', params: { sessionId: 'external-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x'.repeat(16384) } } } });
   send({ id: prompt, result: { stopReason: 'end_turn' } });
  }
  if (mode === 'permission') {
   send({ id: 'permission', method: 'session/request_permission', params: {
    sessionId: 'external-session', toolCall: { toolCallId: 'external-tool', title: 'Write requested externally', kind: 'edit', rawInput: { secret: 'external-private-input' } },
    options: [{ optionId: 'one', kind: 'allow_once', name: 'Once' }, { optionId: 'always', kind: 'allow_always', name: 'Always' }, { optionId: 'reject', kind: 'reject_once', name: 'Reject' }]
   } });
  } else if (mode === 'direct') {
   send({ id: 'direct', method: 'fs/read_text_file', params: { path: '/etc/passwd' } });
  }
 } else if (message.id === 'permission' || message.id === 'direct') {
  send({ method: 'session/update', params: { sessionId: 'external-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: message.id === 'permission' ? 'permission-' + message.result.outcome.optionId : 'direct-denied-' + message.error.code } } } });
  send({ id: prompt, result: { stopReason: 'end_turn' } });
 }
}
`;

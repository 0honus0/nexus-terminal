import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatWorkspaceTerminalError } from '../../packages/frontend/src/features/agent/runtime/workspace-terminal-errors';

const translate = ((key: string): string => `T:${key}`) as Parameters<typeof formatWorkspaceTerminalError>[0];

assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_PROTOCOL_INVALID'),
  'T:agent.workspaceRuntime.terminalError.protocolInvalid',
);
assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_ATTACH_FAILED'),
  'T:agent.workspaceRuntime.terminalError.attachFailed',
);
assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_RECONNECT_EXHAUSTED'),
  'T:agent.workspaceRuntime.terminalError.reconnectExhausted',
);
assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_INPUT_QUEUE_FULL'),
  'T:agent.workspaceRuntime.terminalError.inputQueueFull',
);
assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_SESSION_CHANGED'),
  'T:agent.workspaceRuntime.terminalError.sessionChanged',
);
assert.equal(
  formatWorkspaceTerminalError(translate, 'WORKSPACE_TERMINAL_FUTURE_CODE'),
  'T:agent.workspaceRuntime.terminalError.generic',
);

const root = path.resolve(process.cwd(), '../..');
const read = (relativePath: string): string => readFileSync(path.join(root, relativePath), 'utf8');

const component = read('packages/frontend/src/features/agent/runtime/AgentWorkspaceTerminal.vue');
assert(component.includes('@error="handleTerminalError"'));
assert(component.includes('@closed="handleTerminalClosed"'));
assert(!component.includes('@error="error = $event"'));
assert(!component.includes('@closed="error = $event ||'));
assert(component.includes('const handleTerminalClosed = (): void => {'));
assert(component.includes('channel.value = null;'));
assert(component.includes('opened.value = false;'));
assert(component.includes("notice.value = t('agent.workspaceRuntime.terminalClosed')"));

const channel = read('packages/frontend/src/features/agent/runtime/agent-workspace-terminal-channel.ts');
assert(
  channel.includes("finish('WORKSPACE_TERMINAL_PROTOCOL_INVALID', 'WORKSPACE_TERMINAL_PROTOCOL_INVALID');"),
  'malformed protocol messages must enter the terminal closed state',
);
assert(
  channel.includes("finish('WORKSPACE_TERMINAL_SESSION_CHANGED', 'WORKSPACE_TERMINAL_SESSION_CHANGED');"),
  'session changes must preserve their specific terminal error code',
);
assert(
  !channel.includes("catch {\n          emitError('WORKSPACE_TERMINAL_PROTOCOL_INVALID');"),
  'protocol parse failure must not leave a dead-but-open channel',
);

process.stdout.write('agent workspace terminal regression: PASS\n');

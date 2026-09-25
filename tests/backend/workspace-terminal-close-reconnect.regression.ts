import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../packages/frontend/src/runtimes/workspace/session/workspaceRuntimeSession.ts', import.meta.url),
  'utf8',
);

const terminalErrorStart = source.indexOf("this.socket.on('terminal.error'");
assert(terminalErrorStart >= 0, 'terminal.error handler must exist');
const terminalErrorEnd = source.indexOf("this.socket.on('terminal.closed'", terminalErrorStart);
assert(terminalErrorEnd > terminalErrorStart, 'terminal.error handler boundary must remain detectable');
const terminalErrorHandler = source.slice(terminalErrorStart, terminalErrorEnd);
assert(
  terminalErrorHandler.includes('this.scheduleReconnect();'),
  'terminal.error must schedule reconnect because SSH outages can fail before terminal.closed is emitted',
);

const terminalClosedStart = source.indexOf("this.socket.on('terminal.closed'");
assert(terminalClosedStart >= 0, 'terminal.closed handler must exist');
const terminalClosedEnd = source.indexOf("this.socket.on('protocol.error'", terminalClosedStart);
assert(terminalClosedEnd > terminalClosedStart, 'terminal.closed handler boundary must remain detectable');
const terminalClosedHandler = source.slice(terminalClosedStart, terminalClosedEnd);

assert(terminalClosedHandler.includes("this.state.value = 'disconnected';"));
assert(
  terminalClosedHandler.includes('this.scheduleReconnect();'),
  'terminal.closed must schedule reconnect because the shared Workspace control socket remains open',
);
assert(
  source.includes(
    'if (this.reconnectTimer !== undefined || this.disposed || this.closing || this.markedForSuspend.value) return;',
  ),
  'reconnect scheduling must remain guarded for closing/suspended sessions',
);

process.stdout.write('Workspace terminal-close reconnect regression: PASS\n');

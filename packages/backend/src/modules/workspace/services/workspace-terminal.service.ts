import { StringDecoder } from 'node:string_decoder';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';
import type { WorkspaceShellIntegrationService } from './workspace-shell-integration.service';

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_QUEUED_INPUT_BYTES = 1024 * 1024;
interface InputItem {
  data: string;
  sequence?: number;
  bytes: number;
}
interface TerminalState {
  stdout: StringDecoder;
  stderr: StringDecoder;
  queue: InputItem[];
  queuedBytes: number;
  waitingForDrain: boolean;
  unsubscribers: Array<() => void>;
  drainOff?: () => void;
  columns?: number;
  rows?: number;
  consumerBackpressure: boolean;
}

/** Owns shell byte flow/backpressure. WebSocket framing and terminal output ACKs stay in Interfaces. */
export class WorkspaceTerminalService {
  private readonly states = new Map<string, TerminalState>();
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly integration: WorkspaceShellIntegrationService,
    private readonly events: WorkspaceEventHub,
  ) {}
  attach(sessionId: string): void {
    if (this.states.has(sessionId)) return;
    const session = this.sessions.require(sessionId),
      state: TerminalState = {
        stdout: new StringDecoder('utf8'),
        stderr: new StringDecoder('utf8'),
        queue: [],
        queuedBytes: 0,
        waitingForDrain: false,
        unsubscribers: [],
        consumerBackpressure: false,
      };
    this.states.set(sessionId, state);
    state.unsubscribers.push(
      session.shell.onData((data) => this.forwardStdout(sessionId, state, data)),
      session.shell.onStderr((data) => this.forwardStderr(sessionId, state, data)),
      session.shell.onClose(() => {
        this.flush(sessionId, state);
        this.events.publish(sessionId, { type: 'terminal-closed' });
      }),
      session.shell.onError((error) =>
        this.events.publish(sessionId, { type: 'terminal-error', message: error.message }),
      ),
    );
  }
  detach(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    this.flush(sessionId, state);
    state.drainOff?.();
    for (const off of state.unsubscribers.splice(0))
      try {
        off();
      } catch {}
    this.states.delete(sessionId);
  }
  writeInput(sessionId: string, data: string, sequence?: number): void {
    if (typeof data !== 'string') throw new Error('SSH input must be a string.');
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > MAX_INPUT_BYTES) throw new Error(`SSH input exceeds ${MAX_INPUT_BYTES} bytes.`);
    if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff))
      throw new Error('Invalid SSH input sequence.');
    const state = this.requireState(sessionId);
    if (state.queuedBytes + bytes > MAX_QUEUED_INPUT_BYTES) throw new Error('SSH input queue limit exceeded.');
    this.integration.noteUserInput(sessionId);
    state.queue.push({ data, sequence, bytes });
    state.queuedBytes += bytes;
    this.drain(sessionId, state);
  }
  resize(sessionId: string, columns: number, rows: number): void {
    if (
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 2 ||
      rows < 1 ||
      columns > 1000 ||
      rows > 500
    )
      throw new Error('Invalid terminal size.');
    const state = this.requireState(sessionId);
    if (state.columns === columns && state.rows === rows) return;
    this.sessions.require(sessionId).shell.resize(columns, rows);
    state.columns = columns;
    state.rows = rows;
  }
  setConsumerBackpressure(sessionId: string, active: boolean): void {
    const state = this.requireState(sessionId);
    if (state.consumerBackpressure === active) return;
    state.consumerBackpressure = active;
    const shell = this.sessions.require(sessionId).shell;
    if (active) shell.pause();
    else shell.resume();
  }
  private requireState(id: string) {
    const state = this.states.get(id);
    if (!state) throw new Error(`Terminal ${id} is not attached.`);
    return state;
  }
  private drain(id: string, state: TerminalState) {
    if (state.waitingForDrain) return;
    const shell = this.sessions.require(id).shell;
    while (state.queue.length) {
      const item = state.queue.shift()!;
      state.queuedBytes -= item.bytes;
      const accepted = shell.write(item.data);
      if (item.sequence !== undefined)
        this.events.publish(id, { type: 'terminal-input-ack', sequence: item.sequence, bytes: item.bytes });
      if (!accepted) {
        state.waitingForDrain = true;
        let off: () => void = () => {};
        off = shell.onDrain(() => {
          off();
          state.drainOff = undefined;
          state.waitingForDrain = false;
          this.drain(id, state);
        });
        state.drainOff = off;
        return;
      }
    }
  }
  private forwardStdout(id: string, state: TerminalState, data: Uint8Array) {
    const decoded = state.stdout.write(Buffer.from(data));
    const visible = this.integration.filterOutput(id, decoded);
    if (visible) this.events.publish(id, { type: 'terminal-output', data: Buffer.from(visible, 'utf8') });
  }
  private forwardStderr(id: string, state: TerminalState, data: Uint8Array) {
    const decoded = state.stderr.write(Buffer.from(data));
    if (decoded) this.events.publish(id, { type: 'terminal-output', data: Buffer.from(decoded, 'utf8'), stderr: true });
  }
  private flush(id: string, state: TerminalState) {
    const stdout = state.stdout.end();
    if (stdout) {
      const visible = this.integration.filterOutput(id, stdout);
      if (visible) this.events.publish(id, { type: 'terminal-output', data: Buffer.from(visible, 'utf8') });
    }
    const stderr = state.stderr.end();
    if (stderr) this.events.publish(id, { type: 'terminal-output', data: Buffer.from(stderr, 'utf8'), stderr: true });
  }
}

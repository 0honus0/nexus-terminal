import { logger } from '../../../shared/logging/logger';
import { runtimePerformanceMetrics } from '../../../shared/observability/runtime-performance';
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
  queue: InputItem[];
  queueHead: number;
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
        queue: [],
        queueHead: 0,
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
      session.shell.onError((error) => {
        logger.warn({ err: error, workspaceId: sessionId }, 'Workspace terminal shell error');
        this.events.publish(sessionId, { type: 'terminal-error', message: error.message });
      }),
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
    if (state.queuedBytes + bytes > MAX_QUEUED_INPUT_BYTES) {
      logger.warn(
        {
          workspaceId: sessionId,
          incomingBytes: bytes,
          queuedBytes: state.queuedBytes,
          queueLimitBytes: MAX_QUEUED_INPUT_BYTES,
        },
        'Workspace terminal input queue limit exceeded',
      );
      throw new Error('SSH input queue limit exceeded.');
    }
    this.integration.noteUserInput(sessionId);
    state.queue.push({ data, sequence, bytes });
    state.queuedBytes += bytes;
    runtimePerformanceMetrics.recordTerminalInputQueued(bytes, state.queuedBytes);
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
    while (state.queueHead < state.queue.length) {
      const item = state.queue[state.queueHead++]!;
      state.queuedBytes -= item.bytes;
      const accepted = shell.write(item.data);
      if (item.sequence !== undefined)
        this.events.publish(id, { type: 'terminal-input-ack', sequence: item.sequence, bytes: item.bytes });
      if (!accepted) {
        runtimePerformanceMetrics.recordTerminalInputDrainPause();
        state.waitingForDrain = true;
        logger.debug({ workspaceId: id, queuedBytes: state.queuedBytes }, 'SSH terminal input waiting for drain');
        let off: () => void = () => {};
        off = shell.onDrain(() => {
          off();
          state.drainOff = undefined;
          state.waitingForDrain = false;
          this.drain(id, state);
        });
        state.drainOff = off;
        this.compactInputQueue(state);
        return;
      }
    }
    this.compactInputQueue(state);
  }

  private compactInputQueue(state: TerminalState): void {
    if (state.queueHead === state.queue.length) {
      state.queue.length = 0;
      state.queueHead = 0;
    } else if (state.queueHead >= 1024 && state.queueHead * 2 >= state.queue.length) {
      state.queue.splice(0, state.queueHead);
      state.queueHead = 0;
    }
  }
  private forwardStdout(id: string, _state: TerminalState, data: Uint8Array) {
    const filterStartedAt = runtimePerformanceMetrics.operationStarted();
    const visible = this.integration.filterOutput(id, data);
    if (filterStartedAt !== 0n) {
      runtimePerformanceMetrics.recordTerminalMarkerFilter(process.hrtime.bigint() - filterStartedAt);
    }
    if (visible.byteLength) this.events.publish(id, { type: 'terminal-output', data: visible });
  }
  private forwardStderr(id: string, _state: TerminalState, data: Uint8Array) {
    if (data.byteLength) this.events.publish(id, { type: 'terminal-output', data, stderr: true });
  }
  private flush(_id: string, _state: TerminalState) {
    // Byte-oriented marker filtering keeps only bounded ASCII marker remainders.
    // They are intentionally not emitted on close because they can only be an incomplete Nexus control marker.
  }
}

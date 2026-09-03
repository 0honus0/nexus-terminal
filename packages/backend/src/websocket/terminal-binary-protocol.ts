import WebSocket from 'ws';
import type { WorkspaceSession } from '../workspace/workspace-session';

const TERMINAL_FRAME_MAGIC = Buffer.from('NXTM', 'ascii');
const TERMINAL_FRAME_VERSION = 1;
const TERMINAL_FRAME_HEADER_SIZE = 16;
const MAX_TERMINAL_FRAME_PAYLOAD_BYTES = 256 * 1024;
const TERMINAL_OUTPUT_BATCH_BYTES = 64 * 1024;
const TERMINAL_OUTPUT_BATCH_DELAY_MS = 1;
const TERMINAL_BACKPRESSURE_HIGH_WATER_BYTES = 1024 * 1024;
const TERMINAL_BACKPRESSURE_LOW_WATER_BYTES = 256 * 1024;
const TERMINAL_BACKPRESSURE_POLL_MS = 10;
const TERMINAL_ACK_TIMEOUT_MS = 120_000;

interface PendingTerminalAck {
  bytes: number;
  resolve?: () => void;
  reject?: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

interface TerminalTransportState {
  chunks: Buffer[];
  bytes: number;
  flushTimer?: NodeJS.Timeout;
  backpressureTimer?: NodeJS.Timeout;
  streamPausedByTransport: boolean;
  networkBackpressureActive: boolean;
  applicationBackpressureActive: boolean;
  pendingAcks: Map<number, PendingTerminalAck>;
  unackedBytes: number;
}

const transportStates = new WeakMap<WorkspaceSession, TerminalTransportState>();

const getTransportState = (state: WorkspaceSession): TerminalTransportState => {
  let transport = transportStates.get(state);
  if (!transport) {
    transport = {
      chunks: [],
      bytes: 0,
      streamPausedByTransport: false,
      networkBackpressureActive: false,
      applicationBackpressureActive: false,
      pendingAcks: new Map(),
      unackedBytes: 0,
    };
    transportStates.set(state, transport);
  }
  return transport;
};

export const enum TerminalFrameType {
  Output = 1,
  CachedOutput = 2,
}

export const enum TerminalFrameFlag {
  Final = 1 << 0,
}

const nextSequence = (state: WorkspaceSession): number => {
  const sequence = state.terminalOutputSequence ?? 0;
  state.terminalOutputSequence = (sequence + 1) >>> 0;
  return sequence;
};

interface EncodedTerminalFrame {
  frame: Buffer;
  sequence: number;
}

const createTerminalFrame = (
  state: WorkspaceSession,
  type: TerminalFrameType,
  payload: Buffer,
  flags: number,
): EncodedTerminalFrame => {
  if (payload.length > MAX_TERMINAL_FRAME_PAYLOAD_BYTES) {
    throw new Error(`Terminal binary frame payload exceeds ${MAX_TERMINAL_FRAME_PAYLOAD_BYTES} bytes`);
  }

  const sequence = nextSequence(state);
  const frame = Buffer.allocUnsafe(TERMINAL_FRAME_HEADER_SIZE + payload.length);
  TERMINAL_FRAME_MAGIC.copy(frame, 0);
  frame.writeUInt8(TERMINAL_FRAME_VERSION, 4);
  frame.writeUInt8(type, 5);
  frame.writeUInt8(flags, 6);
  frame.writeUInt8(TERMINAL_FRAME_HEADER_SIZE, 7);
  frame.writeUInt32BE(payload.length, 8);
  frame.writeUInt32BE(sequence, 12);
  payload.copy(frame, TERMINAL_FRAME_HEADER_SIZE);
  return { frame, sequence };
};

const splitPayload = (payload: Buffer): Buffer[] => {
  if (payload.length === 0) return [payload];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += MAX_TERMINAL_FRAME_PAYLOAD_BYTES) {
    chunks.push(payload.subarray(offset, Math.min(offset + MAX_TERMINAL_FRAME_PAYLOAD_BYTES, payload.length)));
  }
  return chunks;
};

const reconcileStreamFlow = (state: WorkspaceSession): void => {
  const transport = getTransportState(state);
  const shouldPause =
    transport.networkBackpressureActive || transport.applicationBackpressureActive || state.terminalOutputHold === true;
  if (shouldPause && !transport.streamPausedByTransport && state.sshShellStream) {
    state.sshShellStream.pause();
    transport.streamPausedByTransport = true;
  } else if (!shouldPause && transport.streamPausedByTransport) {
    state.sshShellStream?.resume();
    transport.streamPausedByTransport = false;
  }
};

const monitorBackpressure = (state: WorkspaceSession): void => {
  const transport = getTransportState(state);
  if (transport.backpressureTimer) return;

  const check = () => {
    transport.backpressureTimer = undefined;
    if (state.ws.readyState !== WebSocket.OPEN) return;

    if (state.ws.bufferedAmount <= TERMINAL_BACKPRESSURE_LOW_WATER_BYTES) {
      transport.networkBackpressureActive = false;
      reconcileStreamFlow(state);
      return;
    }

    transport.backpressureTimer = setTimeout(check, TERMINAL_BACKPRESSURE_POLL_MS);
    transport.backpressureTimer.unref?.();
  };

  transport.backpressureTimer = setTimeout(check, TERMINAL_BACKPRESSURE_POLL_MS);
  transport.backpressureTimer.unref?.();
};

const applyBackpressure = (state: WorkspaceSession): void => {
  if (state.ws.bufferedAmount < TERMINAL_BACKPRESSURE_HIGH_WATER_BYTES) return;
  const transport = getTransportState(state);
  transport.networkBackpressureActive = true;
  reconcileStreamFlow(state);
  monitorBackpressure(state);
};

const registerPendingAck = (
  state: WorkspaceSession,
  sequence: number,
  bytes: number,
  waiter?: Pick<PendingTerminalAck, 'resolve' | 'reject'>,
): void => {
  const transport = getTransportState(state);
  if (transport.pendingAcks.has(sequence)) {
    throw new Error(`Terminal output sequence ${sequence} is still pending`);
  }
  const pending: PendingTerminalAck = { bytes, ...waiter };
  pending.timeout = setTimeout(() => {
    transport.pendingAcks.delete(sequence);
    transport.unackedBytes = Math.max(0, transport.unackedBytes - bytes);
    const error = new Error(`Terminal output ACK timeout for sequence ${sequence}`);
    pending.reject?.(error);
    if (transport.unackedBytes <= TERMINAL_BACKPRESSURE_LOW_WATER_BYTES) {
      transport.applicationBackpressureActive = false;
      reconcileStreamFlow(state);
    }
    if (state.ws.readyState === WebSocket.OPEN) state.ws.close(1011, 'Terminal output ACK timeout');
  }, TERMINAL_ACK_TIMEOUT_MS);
  pending.timeout.unref?.();
  transport.pendingAcks.set(sequence, pending);
  transport.unackedBytes += bytes;
  if (transport.unackedBytes >= TERMINAL_BACKPRESSURE_HIGH_WATER_BYTES) {
    transport.applicationBackpressureActive = true;
    reconcileStreamFlow(state);
  }
};

const discardPendingAck = (state: WorkspaceSession, sequence: number, error: Error): void => {
  const transport = getTransportState(state);
  const pending = transport.pendingAcks.get(sequence);
  if (!pending) return;
  transport.pendingAcks.delete(sequence);
  if (pending.timeout) clearTimeout(pending.timeout);
  transport.unackedBytes = Math.max(0, transport.unackedBytes - pending.bytes);
  pending.reject?.(error);
  if (transport.unackedBytes <= TERMINAL_BACKPRESSURE_LOW_WATER_BYTES) {
    transport.applicationBackpressureActive = false;
    reconcileStreamFlow(state);
  }
};

export const acknowledgeTerminalOutput = (state: WorkspaceSession, sequence: number): boolean => {
  const transport = getTransportState(state);
  const pending = transport.pendingAcks.get(sequence);
  if (!pending) return false;
  transport.pendingAcks.delete(sequence);
  if (pending.timeout) clearTimeout(pending.timeout);
  transport.unackedBytes = Math.max(0, transport.unackedBytes - pending.bytes);
  pending.resolve?.();
  if (transport.unackedBytes <= TERMINAL_BACKPRESSURE_LOW_WATER_BYTES) {
    transport.applicationBackpressureActive = false;
    reconcileStreamFlow(state);
  }
  return true;
};

export const setTerminalOutputHold = (state: WorkspaceSession, hold: boolean): void => {
  state.terminalOutputHold = hold;
  reconcileStreamFlow(state);
};

export const sendTerminalFrames = (
  state: WorkspaceSession,
  type: TerminalFrameType,
  payload: Buffer,
  flags = 0,
): boolean => {
  if (state.ws.readyState !== WebSocket.OPEN) return false;

  const chunks = splitPayload(payload);
  for (let index = 0; index < chunks.length; index += 1) {
    const isLastChunk = index === chunks.length - 1;
    const frameFlags = isLastChunk ? flags : flags & ~TerminalFrameFlag.Final;
    const encoded = createTerminalFrame(state, type, chunks[index], frameFlags);
    registerPendingAck(state, encoded.sequence, chunks[index].length);
    try {
      state.ws.send(encoded.frame, { binary: true });
    } catch (error) {
      discardPendingAck(state, encoded.sequence, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
  applyBackpressure(state);
  return true;
};

export const flushTerminalOutput = (state: WorkspaceSession): void => {
  const transport = getTransportState(state);
  if (transport.flushTimer) {
    clearTimeout(transport.flushTimer);
    transport.flushTimer = undefined;
  }
  if (transport.bytes === 0) return;

  const payload =
    transport.chunks.length === 1 ? transport.chunks[0] : Buffer.concat(transport.chunks, transport.bytes);
  transport.chunks = [];
  transport.bytes = 0;
  sendTerminalFrames(state, TerminalFrameType.Output, payload);
};

export const queueTerminalOutput = (state: WorkspaceSession, payload: Buffer): void => {
  if (payload.length === 0 || state.ws.readyState !== WebSocket.OPEN) return;
  const transport = getTransportState(state);

  for (let offset = 0; offset < payload.length; offset += TERMINAL_OUTPUT_BATCH_BYTES) {
    const chunk = payload.subarray(offset, Math.min(offset + TERMINAL_OUTPUT_BATCH_BYTES, payload.length));
    if (transport.bytes > 0 && transport.bytes + chunk.length > TERMINAL_OUTPUT_BATCH_BYTES) {
      flushTerminalOutput(state);
    }
    transport.chunks.push(chunk);
    transport.bytes += chunk.length;
    if (transport.bytes >= TERMINAL_OUTPUT_BATCH_BYTES) flushTerminalOutput(state);
  }

  if (transport.bytes > 0 && !transport.flushTimer) {
    transport.flushTimer = setTimeout(() => flushTerminalOutput(state), TERMINAL_OUTPUT_BATCH_DELAY_MS);
    transport.flushTimer.unref?.();
  }
};

export const disposeTerminalTransport = (state: WorkspaceSession): void => {
  const transport = transportStates.get(state);
  if (!transport) return;
  if (transport.flushTimer) clearTimeout(transport.flushTimer);
  if (transport.backpressureTimer) clearTimeout(transport.backpressureTimer);
  for (const pending of transport.pendingAcks.values()) {
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.reject?.(new Error('Terminal transport disposed before ACK'));
  }
  transport.pendingAcks.clear();
  if (transport.streamPausedByTransport && !state.terminalOutputHold) state.sshShellStream?.resume();
  transportStates.delete(state);
};

export const sendTerminalFrameAndWaitForAck = (
  state: WorkspaceSession,
  type: TerminalFrameType,
  payload: Buffer,
  flags = 0,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (state.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket is not open'));
      return;
    }
    if (payload.length > MAX_TERMINAL_FRAME_PAYLOAD_BYTES) {
      reject(new Error(`Terminal binary frame payload exceeds ${MAX_TERMINAL_FRAME_PAYLOAD_BYTES} bytes`));
      return;
    }
    const encoded = createTerminalFrame(state, type, payload, flags);
    registerPendingAck(state, encoded.sequence, payload.length, { resolve, reject });
    try {
      state.ws.send(encoded.frame, { binary: true }, (error) => {
        if (error) discardPendingAck(state, encoded.sequence, error);
      });
    } catch (error) {
      discardPendingAck(state, encoded.sequence, error instanceof Error ? error : new Error(String(error)));
    }
  });

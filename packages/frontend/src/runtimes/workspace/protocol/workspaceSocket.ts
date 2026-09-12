import { logger } from '@/client/logging/logger';
import { openWebSocket } from '@/client/websocket';
import { decodeWorkspaceBinaryFrame } from './workspaceBinaryProtocol';

interface ProtocolResponse<T = unknown> {
  type: 'response';
  requestId: string;
  payload: { ok: boolean; data?: T; error?: string };
}

interface ProtocolEvent<T = unknown> {
  type: string;
  payload?: T;
}

type EventHandler<T = unknown> = (payload: T) => void;
type BinaryHandler = (data: Uint8Array) => void;

interface PendingRequest {
  operation: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: number;
  expectBinary: boolean;
  responseReceived: boolean;
  responseValue?: unknown;
  binaryDone: boolean;
  binaryChunks: Uint8Array[];
  binaryBytes: number;
}

interface WorkspaceSocketLogContext {
  workspaceId?: string;
  connectionId?: number;
}

const workspaceFailureKind = (reason: string): string => {
  const value = reason.toLowerCase();
  if (value.includes('workspace session') && value.includes('not found')) return 'workspace_not_found';
  if (value.includes('workspace socket is not connected')) return 'workspace_not_connected';
  if (value.includes('suspended session') && value.includes('not found')) return 'suspended_session_not_found';
  if (value.includes('no prepared resume exists')) return 'resume_not_prepared';
  if (value.includes('workspace resume') && value.includes('already pending')) return 'resume_already_pending';
  if (value.includes('挂起恢复') && value.includes('取消')) return 'resume_cancelled';
  if (value.includes('挂起恢复事务') && value.includes('失败')) return 'resume_commit_failed';
  if (value.includes('会话不存在') && value.includes('状态不正确')) return 'session_not_found_or_invalid';
  if (value.includes('workspace socket is already bound')) return 'workspace_already_bound';
  if (value.includes('workspace') && value.includes('already exists')) return 'workspace_already_exists';
  if (value.includes('workspaceid is invalid')) return 'invalid_workspace_id';
  if (value.includes('connection') && value.includes('not found')) return 'connection_not_found';
  if (value.includes('unsupported workspace operation')) return 'unsupported_operation';
  if (value.includes('expired') || value.includes('过期')) return 'session_expired';
  if (value.includes('stale')) return 'stale_state';
  if (value.includes('无权')) return 'forbidden';
  if (value.includes('不存在')) return 'not_found';
  if (value.includes('not found')) return 'not_found';
  if (value.includes('invalid') || value.includes('required')) return 'invalid_request';
  return 'request_failed';
};

const OPEN_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const HIGH_FREQUENCY_OPERATIONS = new Set(['terminal.input', 'terminal.resize', 'docker.stats']);
const HIGH_FREQUENCY_EVENTS = new Set(['status.sample', 'transfer.upload', 'transfer.copyMove', 'transfer.archive']);

export class WorkspaceSocket {
  private socket?: WebSocket;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly binaryHandlers = new Set<BinaryHandler>();
  private readonly closeHandlers = new Set<(reason?: string) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();
  private opening?: Promise<void>;
  private rejectOpening?: (error: Error) => void;

  constructor(private readonly logContext: WorkspaceSocketLogContext = {}) {}

  private context(fields: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...this.logContext, ...fields };
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async open(): Promise<void> {
    if (this.connected) return;
    if (this.opening) return this.opening;

    logger.debug(this.context({ pendingRequests: this.pending.size }), 'Workspace WebSocket opening');
    const socket = openWebSocket('/ws/workspace');
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    let rejectOpening!: (error: Error) => void;
    const opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      let openTimer: number | undefined;
      const clearOpenTimer = () => {
        if (openTimer === undefined) return;
        window.clearTimeout(openTimer);
        openTimer = undefined;
      };
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearOpenTimer();
        resolve();
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearOpenTimer();
        reject(error);
      };
      rejectOpening = settleReject;
      this.rejectOpening = rejectOpening;

      openTimer = window.setTimeout(() => {
        const error = new Error('Workspace WebSocket connection timed out.');
        logger.warn(
          this.context({ pendingRequests: this.pending.size, failureKind: 'transport_open_timeout' }),
          'Workspace WebSocket open timed out',
        );
        settleReject(error);
        if (this.socket !== socket) return;

        // Release the transport slot immediately so reconnect can create a fresh socket even if
        // the browser delays the close event for the timed-out CONNECTING socket.
        this.socket = undefined;
        this.rejectPending(error);
        for (const handler of this.errorHandlers) handler(error.message);
        for (const handler of this.closeHandlers) handler(error.message);
        try {
          socket.close(1000, 'Workspace WebSocket open timed out');
        } catch {
          // The browser may already have discarded the failed transport.
        }
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        if (this.socket !== socket) {
          logger.debug(
            this.context({ pendingRequests: this.pending.size }),
            'Workspace WebSocket open ignored because transport was superseded',
          );
          settleReject(new Error('Workspace WebSocket connection was superseded.'));
          return;
        }
        logger.debug(this.context({ pendingRequests: this.pending.size }), 'Workspace WebSocket opened');
        settleResolve();
      };
      socket.onmessage = (event) => {
        if (this.socket === socket) this.handleMessage(event.data);
      };
      socket.onerror = () => {
        const error = new Error('Workspace WebSocket connection failed.');
        logger.debug(
          this.context({
            pendingRequests: this.pending.size,
            readyState: socket.readyState,
            failureKind: 'transport_error',
          }),
          'Workspace WebSocket error event',
        );
        settleReject(error);
        if (this.socket !== socket) return;
        for (const handler of this.errorHandlers) handler(error.message);
      };
      socket.onclose = (event) => {
        const error = new Error(
          `Workspace WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
        );
        // A close-before-open must settle open(); otherwise callers can remain in "connecting"
        // forever because the request timeout starts only after the socket has opened.
        const closeContext = this.context({
          closeCode: event.code,
          reason: event.reason || undefined,
          wasClean: event.wasClean,
          pendingRequests: this.pending.size,
          failureKind: event.code === 1000 ? undefined : 'transport_closed',
        });
        logger.debug(closeContext, 'Workspace WebSocket close event');
        if (event.code !== 1000) logger.warn(closeContext, 'Workspace WebSocket closed unexpectedly');
        settleReject(error);
        if (this.socket !== socket) {
          logger.debug(closeContext, 'Workspace WebSocket stale close ignored');
          return;
        }

        // Ignore late close/error events from an older socket after a reconnect has already
        // installed a replacement. They must never clear the replacement or reject its requests.
        this.socket = undefined;
        this.rejectPending(error);
        for (const handler of this.closeHandlers) handler(event.reason || undefined);
      };
    });

    let tracked!: Promise<void>;
    tracked = opening.finally(() => {
      if (this.opening === tracked) this.opening = undefined;
      if (this.rejectOpening === rejectOpening) this.rejectOpening = undefined;
    });
    this.opening = tracked;
    return tracked;
  }

  close(reason = 'Workspace closed'): void {
    const error = new Error(reason);
    const socket = this.socket;
    logger.debug(
      this.context({
        reason,
        readyState: socket?.readyState,
        pendingRequests: this.pending.size,
        opening: Boolean(this.opening),
      }),
      'Workspace WebSocket close requested',
    );
    this.socket = undefined;
    this.rejectOpening?.(error);
    this.rejectPending(error);
    if (!socket || socket.readyState >= WebSocket.CLOSING) return;
    try {
      socket.close(1000, reason);
    } catch {
      // Best effort: the transport has already been detached from this WorkspaceSocket.
    }
  }

  request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    return this.requestWithId<T>(type, crypto.randomUUID(), payload);
  }

  async requestWithId<T = unknown>(type: string, requestId: string, payload: Record<string, unknown> = {}): Promise<T> {
    return this.requestInternal<T>(type, requestId, payload, false) as Promise<T>;
  }

  requestBinary<T = unknown>(
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ data: T; bytes: Uint8Array }> {
    return this.requestInternal<T>(type, crypto.randomUUID(), payload, true) as Promise<{
      data: T;
      bytes: Uint8Array;
    }>;
  }

  private async requestInternal<T>(
    type: string,
    requestId: string,
    payload: Record<string, unknown>,
    expectBinary: boolean,
  ): Promise<T | { data: T; bytes: Uint8Array }> {
    if (!requestId) throw new Error('Workspace requestId is required.');
    if (this.pending.has(requestId)) throw new Error(`Workspace request is already pending: ${requestId}`);
    await this.open();
    return new Promise<T | { data: T; bytes: Uint8Array }>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        logger.warn(
          this.context({
            operation: type,
            requestId,
            pendingRequests: this.pending.size,
            failureKind: 'request_timeout',
          }),
          'Workspace request timed out',
        );
        reject(new Error(`Workspace request timed out: ${type}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        operation: type,
        resolve: (value) => resolve(value as T | { data: T; bytes: Uint8Array }),
        reject,
        timer,
        expectBinary,
        responseReceived: false,
        binaryDone: false,
        binaryChunks: [],
        binaryBytes: 0,
      });
      try {
        if (!HIGH_FREQUENCY_OPERATIONS.has(type)) {
          logger.trace(
            this.context({ operation: type, requestId, pendingRequests: this.pending.size }),
            'Workspace request queued',
          );
        }
        this.sendJson({ type, requestId, payload });
      } catch (cause) {
        window.clearTimeout(timer);
        this.pending.delete(requestId);
        const error = cause instanceof Error ? cause : new Error(String(cause));
        logger.debug(
          this.context({
            err: error,
            operation: type,
            requestId,
            pendingRequests: this.pending.size,
            failureKind: 'request_dispatch_failed',
          }),
          'Workspace request dispatch failed',
        );
        reject(error);
      }
    });
  }

  async send(type: string, payload: Record<string, unknown> = {}): Promise<void> {
    await this.open();
    if (!HIGH_FREQUENCY_OPERATIONS.has(type))
      logger.trace(this.context({ operation: type }), 'Workspace message dispatch');
    this.sendJson({ type, payload });
  }

  /** Send only through the currently open Workspace transport; never opens/reopens the socket. */
  sendConnected(type: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.connected) return false;
    try {
      this.sendJson({ type, payload });
      return true;
    } catch {
      return false;
    }
  }

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    const listeners = this.handlers.get(type) ?? new Set<EventHandler>();
    listeners.add(handler as EventHandler);
    this.handlers.set(type, listeners);
    return () => {
      listeners.delete(handler as EventHandler);
      if (!listeners.size) this.handlers.delete(type);
    };
  }

  onBinary(handler: BinaryHandler): () => void {
    this.binaryHandlers.add(handler);
    return () => this.binaryHandlers.delete(handler);
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: (message: string) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  private sendJson(value: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Workspace WebSocket is not open.');
    this.socket.send(JSON.stringify(value));
  }

  private handleMessage(raw: unknown): void {
    if (raw instanceof ArrayBuffer) {
      this.handleBinaryMessage(new Uint8Array(raw));
      return;
    }
    if (raw instanceof Blob) {
      void raw.arrayBuffer().then((buffer) => {
        this.handleBinaryMessage(new Uint8Array(buffer));
      });
      return;
    }
    if (typeof raw !== 'string') return;
    let message: ProtocolEvent;
    try {
      message = JSON.parse(raw) as ProtocolEvent;
    } catch (error) {
      logger.warn(
        this.context({ err: error, failureKind: 'protocol_invalid_json' }),
        'Workspace protocol returned invalid JSON',
      );
      for (const handler of this.errorHandlers) handler('Workspace protocol returned invalid JSON.');
      return;
    }
    if (message.type === 'response') {
      const response = message as ProtocolResponse;
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        logger.debug(
          this.context({ requestId: response.requestId, failureKind: 'stale_response' }),
          'Workspace response has no pending request',
        );
        return;
      }
      if (!HIGH_FREQUENCY_OPERATIONS.has(pending.operation)) {
        logger.trace(
          this.context({
            operation: pending.operation,
            requestId: response.requestId,
            ok: response.payload.ok,
            pendingRequests: this.pending.size,
          }),
          'Workspace response dispatched',
        );
      }
      if (!response.payload.ok) {
        this.pending.delete(response.requestId);
        window.clearTimeout(pending.timer);
        const reason = response.payload.error || 'Workspace request failed.';
        logger.debug(
          this.context({
            operation: pending.operation,
            requestId: response.requestId,
            reason,
            failureKind: workspaceFailureKind(reason),
          }),
          'Workspace request rejected',
        );
        pending.reject(new Error(reason));
        return;
      }
      if (!pending.expectBinary) {
        this.pending.delete(response.requestId);
        window.clearTimeout(pending.timer);
        pending.resolve(response.payload.data);
        return;
      }
      pending.responseReceived = true;
      pending.responseValue = response.payload.data;
      this.resolveBinaryPending(response.requestId, pending);
      return;
    }
    const handlers = this.handlers.get(message.type) ?? new Set<EventHandler>();
    if (!HIGH_FREQUENCY_EVENTS.has(message.type)) {
      logger.trace(
        this.context({ eventType: message.type, handlerCount: handlers.size }),
        'Workspace event dispatched',
      );
    }
    for (const handler of handlers) handler(message.payload);
  }

  private handleBinaryMessage(raw: Uint8Array): void {
    let frame;
    try {
      frame = decodeWorkspaceBinaryFrame(raw);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.rejectPending(error);
      for (const handler of this.errorHandlers) handler(error.message);
      this.close('Workspace binary protocol error');
      return;
    }
    if (frame.kind === 'terminal') {
      for (const handler of this.binaryHandlers) handler(frame.data);
      return;
    }
    const pending = this.pending.get(frame.requestId);
    if (!pending || !pending.expectBinary) return;
    if (frame.data.byteLength) {
      const copy = frame.data.slice();
      pending.binaryChunks.push(copy);
      pending.binaryBytes += copy.byteLength;
    }
    if (frame.final) pending.binaryDone = true;
    this.resolveBinaryPending(frame.requestId, pending);
  }

  private resolveBinaryPending(requestId: string, pending: PendingRequest): void {
    if (!pending.expectBinary || !pending.responseReceived || !pending.binaryDone) return;
    this.pending.delete(requestId);
    window.clearTimeout(pending.timer);
    const bytes = new Uint8Array(pending.binaryBytes);
    let offset = 0;
    for (const chunk of pending.binaryChunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    pending.resolve({ data: pending.responseValue, bytes });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

import { logger } from '@/client/logging/logger';
import { openWebSocket } from '@/client/websocket';

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
}

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

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async open(): Promise<void> {
    if (this.connected) return;
    if (this.opening) return this.opening;

    logger.debug({ pendingRequests: this.pending.size }, 'Workspace WebSocket opening');
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
        logger.warn({ pendingRequests: this.pending.size }, 'Workspace WebSocket open timed out');
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
            { pendingRequests: this.pending.size },
            'Workspace WebSocket open ignored because transport was superseded',
          );
          settleReject(new Error('Workspace WebSocket connection was superseded.'));
          return;
        }
        logger.debug({ pendingRequests: this.pending.size }, 'Workspace WebSocket opened');
        settleResolve();
      };
      socket.onmessage = (event) => {
        if (this.socket === socket) this.handleMessage(event.data);
      };
      socket.onerror = () => {
        const error = new Error('Workspace WebSocket connection failed.');
        logger.debug(
          { pendingRequests: this.pending.size, readyState: socket.readyState },
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
        const closeContext = {
          closeCode: event.code,
          reason: event.reason || undefined,
          wasClean: event.wasClean,
          pendingRequests: this.pending.size,
        };
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
      {
        reason,
        readyState: socket?.readyState,
        pendingRequests: this.pending.size,
        opening: Boolean(this.opening),
      },
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
    if (!requestId) throw new Error('Workspace requestId is required.');
    if (this.pending.has(requestId)) throw new Error(`Workspace request is already pending: ${requestId}`);
    await this.open();
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        logger.warn({ operation: type, requestId, pendingRequests: this.pending.size }, 'Workspace request timed out');
        reject(new Error(`Workspace request timed out: ${type}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        operation: type,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        if (!HIGH_FREQUENCY_OPERATIONS.has(type)) {
          logger.trace({ operation: type, requestId, pendingRequests: this.pending.size }, 'Workspace request queued');
        }
        this.sendJson({ type, requestId, payload });
      } catch (cause) {
        window.clearTimeout(timer);
        this.pending.delete(requestId);
        const error = cause instanceof Error ? cause : new Error(String(cause));
        logger.debug(
          { err: error, operation: type, requestId, pendingRequests: this.pending.size },
          'Workspace request dispatch failed',
        );
        reject(error);
      }
    });
  }

  async send(type: string, payload: Record<string, unknown> = {}): Promise<void> {
    await this.open();
    if (!HIGH_FREQUENCY_OPERATIONS.has(type)) logger.trace({ operation: type }, 'Workspace message dispatch');
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
      const bytes = new Uint8Array(raw);
      for (const handler of this.binaryHandlers) handler(bytes);
      return;
    }
    if (raw instanceof Blob) {
      void raw.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        for (const handler of this.binaryHandlers) handler(bytes);
      });
      return;
    }
    if (typeof raw !== 'string') return;
    let message: ProtocolEvent;
    try {
      message = JSON.parse(raw) as ProtocolEvent;
    } catch (error) {
      logger.warn({ err: error }, 'Workspace protocol returned invalid JSON');
      for (const handler of this.errorHandlers) handler('Workspace protocol returned invalid JSON.');
      return;
    }
    if (message.type === 'response') {
      const response = message as ProtocolResponse;
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        logger.debug({ requestId: response.requestId }, 'Workspace response has no pending request');
        return;
      }
      this.pending.delete(response.requestId);
      window.clearTimeout(pending.timer);
      if (!HIGH_FREQUENCY_OPERATIONS.has(pending.operation)) {
        logger.trace(
          {
            operation: pending.operation,
            requestId: response.requestId,
            ok: response.payload.ok,
            pendingRequests: this.pending.size,
          },
          'Workspace response dispatched',
        );
      }
      if (response.payload.ok) pending.resolve(response.payload.data);
      else {
        const reason = response.payload.error || 'Workspace request failed.';
        logger.debug(
          { operation: pending.operation, requestId: response.requestId, reason },
          'Workspace request rejected',
        );
        pending.reject(new Error(reason));
      }
      return;
    }
    const handlers = this.handlers.get(message.type) ?? new Set<EventHandler>();
    if (!HIGH_FREQUENCY_EVENTS.has(message.type)) {
      logger.trace({ eventType: message.type, handlerCount: handlers.size }, 'Workspace event dispatched');
    }
    for (const handler of handlers) handler(message.payload);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

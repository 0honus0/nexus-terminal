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
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class WorkspaceSocket {
  private socket?: WebSocket;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly binaryHandlers = new Set<BinaryHandler>();
  private readonly closeHandlers = new Set<(reason?: string) => void>();
  private readonly errorHandlers = new Set<(message: string) => void>();
  private opening?: Promise<void>;
  private intentionalClose = false;

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async open(): Promise<void> {
    if (this.connected) return;
    if (this.opening) return this.opening;
    this.intentionalClose = false;
    this.opening = new Promise<void>((resolve, reject) => {
      const socket = openWebSocket('/ws/workspace');
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      const failOpen = (message: string) => {
        if (socket.readyState !== WebSocket.OPEN) reject(new Error(message));
      };
      socket.onopen = () => resolve();
      socket.onmessage = (event) => this.handleMessage(event.data);
      socket.onerror = () => {
        const message = 'Workspace WebSocket connection failed.';
        failOpen(message);
        for (const handler of this.errorHandlers) handler(message);
      };
      socket.onclose = (event) => {
        this.socket = undefined;
        this.rejectPending(
          new Error(`Workspace WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''}).`),
        );
        for (const handler of this.closeHandlers) handler(event.reason || undefined);
      };
    }).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  close(reason = 'Workspace closed'): void {
    this.intentionalClose = true;
    this.socket?.close(1000, reason);
    this.socket = undefined;
    this.rejectPending(new Error(reason));
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
        reject(new Error(`Workspace request timed out: ${type}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.sendJson({ type, requestId, payload });
      } catch (cause) {
        window.clearTimeout(timer);
        this.pending.delete(requestId);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  async send(type: string, payload: Record<string, unknown> = {}): Promise<void> {
    await this.open();
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
    } catch {
      for (const handler of this.errorHandlers) handler('Workspace protocol returned invalid JSON.');
      return;
    }
    if (message.type === 'response') {
      const response = message as ProtocolResponse;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      window.clearTimeout(pending.timer);
      if (response.payload.ok) pending.resolve(response.payload.data);
      else pending.reject(new Error(response.payload.error || 'Workspace request failed.'));
      return;
    }
    for (const handler of this.handlers.get(message.type) ?? []) handler(message.payload);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

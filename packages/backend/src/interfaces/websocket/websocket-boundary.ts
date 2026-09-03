export interface WebSocketInboundMessage<TPayload = unknown> {
  type: string;
  requestId?: string;
  payload?: TPayload;
}

export interface WebSocketOutboundMessage<TPayload = unknown> {
  type: string;
  requestId?: string;
  payload?: TPayload;
}

/** Protocol-neutral client shape consumed by WebSocket handlers/adapters. */
export interface WorkspaceSocketClient {
  readonly userId: number;
  send(message: WebSocketOutboundMessage): void;
  close(code?: number, reason?: string): void;
}

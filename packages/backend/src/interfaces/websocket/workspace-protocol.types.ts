import type { WebSocketInboundMessage, WebSocketOutboundMessage } from './websocket-boundary';

export interface ProtocolResponsePayload<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type WorkspaceProtocolRequest = WebSocketInboundMessage<Record<string, unknown>>;
export type WorkspaceProtocolResponse<T = unknown> = WebSocketOutboundMessage<ProtocolResponsePayload<T>> & {
  type: 'response';
  requestId: string;
};

export type WorkspaceProtocolEvent<T = unknown> = WebSocketOutboundMessage<T>;

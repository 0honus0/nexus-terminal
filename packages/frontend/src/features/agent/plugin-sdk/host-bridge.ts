import { agentApi, type PluginFrontendDescriptor } from '../api/agent-api';
import { PluginAgentSdkDispatcher } from './agent-dispatcher';
import {
  PLUGIN_FRONTEND_AGENT_RPC_METHODS,
  PLUGIN_FRONTEND_BACKEND_RPC_METHODS,
  PLUGIN_FRONTEND_PROTOCOL_VERSION,
  PLUGIN_FRONTEND_RPC_METHODS,
  type PluginFrontendAgentRpcMethod,
  type PluginFrontendBackendRpcMethod,
  type PluginFrontendRpcMethod,
  type PluginFrontendRunEvent,
} from './protocol';

const PROTOCOL_VERSION = PLUGIN_FRONTEND_PROTOCOL_VERSION;
const MAX_IN_FLIGHT = 8;
const textEncoder = new TextEncoder();
const allowedMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_RPC_METHODS);
const backendMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_BACKEND_RPC_METHODS);
const agentMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_AGENT_RPC_METHODS);

interface PluginReadyMessage {
  type: 'nexus.plugin.ready';
  protocol: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
}

interface PluginAckMessage {
  type: 'nexus.plugin.ack';
  protocol: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  nonce: string;
  seq: 0;
}

interface PluginRequestMessage {
  type: 'nexus.plugin.request';
  protocol: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  nonce: string;
  seq: number;
  id: string;
  method: PluginFrontendRpcMethod;
  params: unknown;
}

type PluginPortMessage = PluginAckMessage | PluginRequestMessage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const serializedBytes = (value: unknown): number => {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const nonce = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

const errorResponse = (request: PluginRequestMessage, code: string) => ({
  type: 'nexus.plugin.response' as const,
  protocol: PROTOCOL_VERSION,
  nonce: request.nonce,
  seq: request.seq,
  id: request.id,
  ok: false,
  error: { code },
});

export class PluginFrontendHostBridge {
  private readonly bridgeNonce = nonce();
  private readonly pending = new Map<string, AbortController>();
  private readonly agent: PluginAgentSdkDispatcher;
  private port: MessagePort | null = null;
  private connected = false;
  private closed = false;
  private lastSequence = 0;
  private handshakeTimer: number | null = null;
  private resolveHandshake: (() => void) | null = null;
  private rejectHandshake: ((error: Error) => void) | null = null;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly appId: string,
    private readonly descriptor: PluginFrontendDescriptor,
  ) {
    this.agent = new PluginAgentSdkDispatcher(appId, (event) => this.postRunEvent(event));
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('PLUGIN_BRIDGE_CLOSED'));
    if (this.connected) return Promise.resolve();
    window.addEventListener('message', this.onWindowMessage);
    return new Promise<void>((resolve, reject) => {
      this.resolveHandshake = resolve;
      this.rejectHandshake = reject;
      this.handshakeTimer = window.setTimeout(() => {
        this.failHandshake(new Error('PLUGIN_BRIDGE_HANDSHAKE_TIMEOUT'));
      }, this.descriptor.requestTimeoutMs);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('message', this.onWindowMessage);
    if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    this.agent.close();
    this.port?.close();
    this.port = null;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    if (!this.connected) this.rejectHandshake?.(new Error('PLUGIN_BRIDGE_CLOSED'));
    this.resolveHandshake = null;
    this.rejectHandshake = null;
  }

  private readonly onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (this.closed || this.connected || this.port) return;
    const source = this.iframe.contentWindow;
    if (!source || event.source !== source || event.origin !== 'null') return;
    if (!isRecord(event.data) || event.data.type !== 'nexus.plugin.ready' || event.data.protocol !== PROTOCOL_VERSION)
      return;
    const ready = event.data as unknown as PluginReadyMessage;
    if (ready.protocol !== PROTOCOL_VERSION) return;

    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.addEventListener('message', this.onPortMessage);
    this.port.addEventListener('messageerror', this.onPortError);
    this.port.start();
    source.postMessage({ type: 'nexus.plugin.init', protocol: PROTOCOL_VERSION, nonce: this.bridgeNonce }, '*', [
      channel.port2,
    ]);
  };

  private readonly onPortError = (): void => {
    this.close();
  };

  private readonly onPortMessage = (event: MessageEvent<unknown>): void => {
    if (this.closed || !this.port || serializedBytes(event.data) > this.descriptor.maxMessageBytes) {
      this.close();
      return;
    }
    if (!isRecord(event.data) || event.data.protocol !== PROTOCOL_VERSION || event.data.nonce !== this.bridgeNonce) {
      this.close();
      return;
    }

    if (!this.connected) {
      if (event.data.type !== 'nexus.plugin.ack' || event.data.seq !== 0) {
        this.close();
        return;
      }
      this.connected = true;
      window.removeEventListener('message', this.onWindowMessage);
      if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.resolveHandshake?.();
      this.resolveHandshake = null;
      this.rejectHandshake = null;
      return;
    }

    if (event.data.type !== 'nexus.plugin.request') return;
    const message = event.data as unknown as PluginPortMessage;
    if (!('method' in message) || !this.validRequest(message)) {
      this.close();
      return;
    }
    this.lastSequence = message.seq;
    void this.forward(message);
  };

  private validRequest(message: PluginRequestMessage): boolean {
    return (
      Number.isSafeInteger(message.seq) &&
      message.seq === this.lastSequence + 1 &&
      typeof message.id === 'string' &&
      message.id.length > 0 &&
      message.id.length <= 128 &&
      !this.pending.has(message.id) &&
      allowedMethods.has(message.method) &&
      serializedBytes(message.params) <= this.descriptor.maxMessageBytes
    );
  }

  private async forward(request: PluginRequestMessage): Promise<void> {
    if (!this.port) return;
    if (this.pending.size >= MAX_IN_FLIGHT) {
      this.post(errorResponse(request, 'HOST_RPC_BUSY'));
      return;
    }
    const controller = new AbortController();
    this.pending.set(request.id, controller);
    const timer = window.setTimeout(() => controller.abort(), this.descriptor.requestTimeoutMs);
    try {
      let result: unknown;
      if (backendMethods.has(request.method)) {
        result = await agentApi.pluginFrontendRpc(
          this.appId,
          request.method as PluginFrontendBackendRpcMethod,
          request.params,
          controller.signal,
        );
      } else if (agentMethods.has(request.method)) {
        result = await this.agent.dispatch(request.method as PluginFrontendAgentRpcMethod, request.params);
      } else {
        throw new Error('PLUGIN_FRONTEND_RPC_METHOD_DENIED');
      }
      if (controller.signal.aborted) {
        this.post(errorResponse(request, 'HOST_RPC_TIMEOUT'));
        return;
      }
      const response = {
        type: 'nexus.plugin.response' as const,
        protocol: PROTOCOL_VERSION,
        nonce: this.bridgeNonce,
        seq: request.seq,
        id: request.id,
        ok: true,
        result,
      };
      if (serializedBytes(response) > this.descriptor.maxMessageBytes) {
        this.post(errorResponse(request, 'HOST_RPC_RESPONSE_TOO_LARGE'));
      } else {
        this.post(response);
      }
    } catch (cause) {
      const code = controller.signal.aborted
        ? 'HOST_RPC_TIMEOUT'
        : cause instanceof Error && /^PLUGIN_[A-Z0-9_]+$/.test(cause.message)
          ? cause.message
          : 'HOST_RPC_FAILED';
      this.post(errorResponse(request, code));
    } finally {
      window.clearTimeout(timer);
      this.pending.delete(request.id);
    }
  }

  private postRunEvent(event: PluginFrontendRunEvent): void {
    this.post({
      type: 'nexus.plugin.event',
      protocol: PROTOCOL_VERSION,
      nonce: this.bridgeNonce,
      channel: 'agent.run',
      ...event,
    });
  }

  private post(message: unknown): void {
    if (!this.closed && this.port && serializedBytes(message) <= this.descriptor.maxMessageBytes) {
      this.port.postMessage(message);
    }
  }

  private failHandshake(error: Error): void {
    this.rejectHandshake?.(error);
    this.resolveHandshake = null;
    this.rejectHandshake = null;
    this.close();
  }
}

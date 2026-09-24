import type { AgentJsonValueDto } from '@nexus-terminal/protocol/agent-common';
import { agentApi, toAgentApiError, type AgentPluginFrontendDescriptorDto } from '../api/agent-api';
import { PluginAgentSdkDispatcher } from './agent-dispatcher';
import {
  PLUGIN_FRONTEND_AGENT_RPC_METHODS,
  PLUGIN_FRONTEND_BACKEND_RPC_METHODS,
  PLUGIN_FRONTEND_BINARY_RPC_METHODS,
  PLUGIN_FRONTEND_PROTOCOL_VERSION,
  PLUGIN_FRONTEND_RPC_METHODS,
  PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES,
  type PluginFrontendAgentRpcMethod,
  type PluginFrontendBackendRpcMethod,
  type PluginFrontendBinaryRpcMethod,
  type PluginFrontendRpcMethod,
  type PluginFrontendRunEvent,
} from './protocol';

const PROTOCOL_VERSION = PLUGIN_FRONTEND_PROTOCOL_VERSION;
const MAX_IN_FLIGHT = 8;
const textEncoder = new TextEncoder();
const allowedMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_RPC_METHODS);
const backendMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_BACKEND_RPC_METHODS);
const agentMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_AGENT_RPC_METHODS);
const binaryMethods = new Set<PluginFrontendRpcMethod>(PLUGIN_FRONTEND_BINARY_RPC_METHODS);

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
  params: AgentJsonValueDto;
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

const transferBytes = (transfer: readonly Transferable[]): number =>
  transfer.reduce<number>((total, value) => total + (value instanceof ArrayBuffer ? value.byteLength : 0), 0);

const hasOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(record).every((key) => allowed.includes(key));

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
    private readonly descriptor: AgentPluginFrontendDescriptorDto,
    private readonly onDisconnected?: () => void,
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
    this.closeInternal(false);
  }

  private closeInternal(notifyDisconnected: boolean): void {
    if (this.closed) return;
    const wasConnected = this.connected;
    this.closed = true;
    window.removeEventListener('message', this.onWindowMessage);
    if (this.handshakeTimer !== null) window.clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    this.agent.close();
    this.port?.close();
    this.port = null;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    if (!wasConnected) this.rejectHandshake?.(new Error('PLUGIN_BRIDGE_CLOSED'));
    this.resolveHandshake = null;
    this.rejectHandshake = null;
    if (notifyDisconnected && wasConnected) {
      try {
        this.onDisconnected?.();
      } catch {
        // Lifecycle notification must not escape the transport shutdown path.
      }
    }
  }

  private disconnect(): void {
    this.closeInternal(true);
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
    this.disconnect();
  };

  private readonly onPortMessage = (event: MessageEvent<unknown>): void => {
    if (this.closed || !this.port || serializedBytes(event.data) > this.descriptor.maxMessageBytes) {
      this.disconnect();
      return;
    }
    if (!isRecord(event.data) || event.data.protocol !== PROTOCOL_VERSION || event.data.nonce !== this.bridgeNonce) {
      this.disconnect();
      return;
    }

    if (!this.connected) {
      if (event.data.type !== 'nexus.plugin.ack' || event.data.seq !== 0) {
        this.disconnect();
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
      this.disconnect();
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
      let transfer: Transferable[] = [];
      if (backendMethods.has(request.method)) {
        result = await agentApi.pluginFrontendRpc(
          this.appId,
          request.method as PluginFrontendBackendRpcMethod,
          request.params,
          controller.signal,
        );
      } else if (agentMethods.has(request.method)) {
        result = await this.agent.dispatch(request.method as PluginFrontendAgentRpcMethod, request.params);
      } else if (binaryMethods.has(request.method)) {
        const binary = await this.dispatchBinary(
          request.method as PluginFrontendBinaryRpcMethod,
          request.params,
          controller.signal,
        );
        result = binary.result;
        transfer = binary.transfer;
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
      if (serializedBytes(response) + transferBytes(transfer) > this.descriptor.maxMessageBytes) {
        this.post(errorResponse(request, 'HOST_RPC_RESPONSE_TOO_LARGE'));
      } else {
        this.post(response, transfer);
      }
    } catch (cause) {
      const apiError = toAgentApiError(cause);
      const code = controller.signal.aborted
        ? 'HOST_RPC_TIMEOUT'
        : cause instanceof Error && /^PLUGIN_[A-Z0-9_]+$/.test(cause.message)
          ? cause.message
          : /^APP_INTENT_[A-Z0-9_]+$/.test(apiError.code)
            ? apiError.code
            : 'HOST_RPC_FAILED';
      this.post(errorResponse(request, code));
    } finally {
      window.clearTimeout(timer);
      this.pending.delete(request.id);
    }
  }

  private async dispatchBinary(
    method: PluginFrontendBinaryRpcMethod,
    params: AgentJsonValueDto,
    signal: AbortSignal,
  ): Promise<{ result: ArrayBuffer; transfer: Transferable[] }> {
    if (method !== 'intents.artifacts.readRange' || !isRecord(params)) {
      throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
    }
    if (!hasOnlyKeys(params, ['receiptId', 'artifactId', 'start', 'endInclusive'])) {
      throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
    }
    if (
      typeof params.receiptId !== 'string' ||
      typeof params.artifactId !== 'string' ||
      !Number.isSafeInteger(params.start) ||
      !Number.isSafeInteger(params.endInclusive)
    ) {
      throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
    }
    const start = Number(params.start);
    const endInclusive = Number(params.endInclusive);
    const expectedBytes = endInclusive - start + 1;
    if (start < 0 || endInclusive < start || expectedBytes > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES) {
      throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
    }
    const content = await agentApi.readReceivedAppIntentArtifactRange(
      this.appId,
      params.receiptId,
      params.artifactId,
      start,
      endInclusive,
      signal,
    );
    if (content.byteLength !== expectedBytes || content.byteLength > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES) {
      throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
    }
    return { result: content, transfer: [content] };
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

  private post(message: unknown, transfer: Transferable[] = []): void {
    if (
      !this.closed &&
      this.port &&
      serializedBytes(message) + transferBytes(transfer) <= this.descriptor.maxMessageBytes
    ) {
      try {
        this.port.postMessage(message, transfer);
      } catch {
        this.disconnect();
      }
    }
  }

  private failHandshake(error: Error): void {
    this.rejectHandshake?.(error);
    this.resolveHandshake = null;
    this.rejectHandshake = null;
    this.close();
  }
}

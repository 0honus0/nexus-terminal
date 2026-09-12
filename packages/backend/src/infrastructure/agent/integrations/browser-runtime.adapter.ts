import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type ConnectionTransport,
  type HTTPRequest,
  type Page,
} from 'puppeteer-core';
import WebSocket, { type RawData } from 'ws';
import type {
  BrowserEndpointSetting,
  BrowserGatewayPort,
  BrowserMessageTransport,
  BrowserSessionRequest,
  BrowserSessionView,
  BrowserSnapshotNode,
  BrowserSnapshotView,
  BrowserTargetSnapshot,
  BrowserTunnelPort,
} from '../../../modules/agent/ai/integrations.types';

const DEFAULT_MAX_NODES = 2_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_TYPE_BYTES = 16 * 1024;
const MAX_NAME_BYTES = 2 * 1024;
const MAX_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const DISCOVERY_MAX_BYTES = 64 * 1024;
const DISCOVERY_TIMEOUT_MS = 10_000;
const PROTOCOL_TIMEOUT_MS = 60_000;
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary']);

interface NodeBinding {
  backendNodeId: number;
}

interface ActiveBrowserSession {
  request: BrowserSessionRequest;
  target: BrowserTargetSnapshot;
  transport: BrowserMessageTransport;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  createdAt: number;
  snapshotId: string | null;
  nodes: Map<string, NodeBinding>;
}

interface ParsedPattern {
  schemes: Set<string> | null;
  wildcardHost: boolean;
  host: string;
  port: string | null;
  pathPrefix: string | null;
}

const rawText = (data: RawData): string => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
};

const stringAt = (strings: string[], index: number | undefined): string =>
  typeof index === 'number' && index >= 0 && index < strings.length ? strings[index]! : '';

const attributesAt = (strings: string[], raw: number[] | undefined): Map<string, string> => {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    result.set(stringAt(strings, raw[index]).toLowerCase(), stringAt(strings, raw[index + 1]));
  }
  return result;
};

const boundedText = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (Buffer.byteLength(normalized, 'utf8') <= MAX_NAME_BYTES) return normalized;
  let result = '';
  for (const character of normalized) {
    if (Buffer.byteLength(result + character, 'utf8') > MAX_NAME_BYTES) break;
    result += character;
  }
  return result;
};

const nodeName = (attributes: Map<string, string>, text: string | null): string | null =>
  boundedText(
    attributes.get('aria-label') ??
      attributes.get('title') ??
      attributes.get('alt') ??
      attributes.get('placeholder') ??
      text,
  );

const roleFor = (tag: string, attributes: Map<string, string>): string | null => {
  const explicit = boundedText(attributes.get('role') ?? null);
  if (explicit) return explicit;
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'input') {
    const type = (attributes.get('type') ?? 'text').toLowerCase();
    if (['button', 'submit', 'reset'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  return null;
};

const isVisibleSemanticNode = (tag: string, role: string | null, name: string | null, href: string | null): boolean =>
  INTERACTIVE_TAGS.has(tag) || role !== null || name !== null || href !== null;

const parsePattern = (value: string): ParsedPattern => {
  const match = /^(\*|https?|wss?):\/\/(\*\.)?([^/:?#]+)(?::(\d{1,5}))?(\/[^?#]*)?$/.exec(value.trim());
  if (!match) throw new Error('BROWSER_URL_PATTERN_INVALID');
  const scheme = match[1]!;
  const port = match[4] ?? null;
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error('BROWSER_URL_PATTERN_INVALID');
  const rawPath = match[5] ?? null;
  if (rawPath && rawPath.includes('*') && !rawPath.endsWith('*')) throw new Error('BROWSER_URL_PATTERN_INVALID');
  return {
    schemes: scheme === '*' ? null : new Set([scheme]),
    wildcardHost: Boolean(match[2]),
    host: match[3]!.toLowerCase().replace(/\.$/, ''),
    port,
    pathPrefix: rawPath ? rawPath.replace(/\*$/, '') : null,
  };
};

const urlAllowed = (value: string, patterns: readonly string[]): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (['data:', 'blob:', 'about:'].includes(url.protocol)) return true;
  const scheme = url.protocol.replace(/:$/, '');
  if (!['http', 'https', 'ws', 'wss'].includes(scheme)) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port || (scheme === 'https' || scheme === 'wss' ? '443' : '80');
  return patterns.some((raw) => {
    let pattern: ParsedPattern;
    try {
      pattern = parsePattern(raw);
    } catch {
      return false;
    }
    if (pattern.schemes && !pattern.schemes.has(scheme)) return false;
    if (pattern.wildcardHost) {
      if (host !== pattern.host && !host.endsWith(`.${pattern.host}`)) return false;
    } else if (host !== pattern.host) return false;
    if (pattern.port && pattern.port !== port) return false;
    if (pattern.pathPrefix && !url.pathname.startsWith(pattern.pathPrefix)) return false;
    return true;
  });
};

const validateEndpoint = (endpoint: BrowserEndpointSetting, expectedVia: 'backend' | 'runner'): URL => {
  if (endpoint.via !== expectedVia) throw new Error('BROWSER_ENDPOINT_VIA_INVALID');
  let url: URL;
  try {
    url = new URL(endpoint.url);
  } catch {
    throw new Error('BROWSER_ENDPOINT_INVALID');
  }
  if (
    !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('BROWSER_ENDPOINT_INVALID');
  }
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && !endpoint.allowPlaintext) {
    throw new Error('BROWSER_ENDPOINT_PLAINTEXT_DENIED');
  }
  return url;
};

const readDiscovery = (url: URL, verifyTls: boolean, signal: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Connection: 'close' },
        ...(url.protocol === 'https:' ? { rejectUnauthorized: verifyTls } : {}),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`BROWSER_ENDPOINT_DISCOVERY_HTTP_${response.statusCode ?? 500}`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > DISCOVERY_MAX_BYTES) {
            request.destroy(new Error('BROWSER_ENDPOINT_DISCOVERY_TOO_LARGE'));
            return;
          }
          chunks.push(buffer);
        });
        response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    const onAbort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error('ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    request.setTimeout(DISCOVERY_TIMEOUT_MS, () => request.destroy(new Error('BROWSER_ENDPOINT_DISCOVERY_TIMEOUT')));
    request.once('error', reject);
    request.once('close', () => signal.removeEventListener('abort', onAbort));
    request.end();
  });

const resolveDirectWebSocketUrl = async (endpoint: BrowserEndpointSetting, signal: AbortSignal): Promise<URL> => {
  const configured = validateEndpoint(endpoint, 'backend');
  if (configured.protocol === 'ws:' || configured.protocol === 'wss:') return configured;
  const discovery = new URL('/json/version', configured);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readDiscovery(discovery, endpoint.verifyTls, signal));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BROWSER_')) throw error;
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  const raw =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).webSocketDebuggerUrl
      : undefined;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 8192) {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  let discovered: URL;
  try {
    discovered = new URL(raw);
  } catch {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  if (!['ws:', 'wss:'].includes(discovered.protocol) || discovered.username || discovered.password) {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  discovered.protocol = configured.protocol === 'https:' ? 'wss:' : 'ws:';
  discovered.hostname = configured.hostname;
  discovered.port = configured.port;
  return discovered;
};

class DirectBrowserMessageTransport implements BrowserMessageTransport {
  private readonly messageListeners = new Set<(message: string) => void>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        void this.close();
        return;
      }
      const message = rawText(data);
      if (Buffer.byteLength(message, 'utf8') > MAX_CDP_MESSAGE_BYTES) {
        void this.close();
        return;
      }
      for (const listener of this.messageListeners) listener(message);
    });
    socket.once('close', () => this.markClosed());
    socket.once('error', () => this.markClosed());
  }

  static async open(endpoint: BrowserEndpointSetting, signal: AbortSignal): Promise<DirectBrowserMessageTransport> {
    const url = await resolveDirectWebSocketUrl(endpoint, signal);
    return await new Promise<DirectBrowserMessageTransport>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('ABORTED'));
        return;
      }
      const socket = new WebSocket(url, {
        perMessageDeflate: false,
        maxPayload: MAX_CDP_MESSAGE_BYTES,
        rejectUnauthorized: endpoint.verifyTls,
      });
      let settled = false;
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.terminate();
        reject(error);
      };
      const onAbort = () => fail(signal.reason instanceof Error ? signal.reason : new Error('ABORTED'));
      socket.once('open', () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new DirectBrowserMessageTransport(socket));
      });
      socket.once('error', fail);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  send(message: string): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) throw new Error('BROWSER_TRANSPORT_CLOSED');
    if (Buffer.byteLength(message, 'utf8') > MAX_CDP_MESSAGE_BYTES) throw new Error('BROWSER_MESSAGE_TOO_LARGE');
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('BROWSER_TRANSPORT_BACKPRESSURE');
    this.socket.send(message);
  }

  onMessage(listener: (message: string) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000);
    }
    this.emitClose();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.emitClose();
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
    this.messageListeners.clear();
  }
}

class PuppeteerMessageTransport implements ConnectionTransport {
  onmessage?: (message: string) => void;
  onclose?: () => void;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose: () => void;

  constructor(private readonly transport: BrowserMessageTransport) {
    this.unsubscribeMessage = transport.onMessage((message) => this.onmessage?.(message));
    this.unsubscribeClose = transport.onClose(() => this.onclose?.());
  }

  send(message: string): void {
    this.transport.send(message);
  }

  close(): void {
    this.unsubscribeMessage();
    this.unsubscribeClose();
    void this.transport.close();
  }
}

export class BrowserRuntimeAdapter implements BrowserGatewayPort {
  private readonly sessions = new Map<string, ActiveBrowserSession>();

  constructor(private readonly tunnels: BrowserTunnelPort) {}

  async createSession(request: BrowserSessionRequest, signal: AbortSignal): Promise<BrowserSessionView> {
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const target = request.target;
    if (!target.endpoints.length || !target.allowedUrlPatterns.length) throw new Error('BROWSER_TARGET_INVALID');
    for (const pattern of target.allowedUrlPatterns) parsePattern(pattern);
    if ((request.workspaceId === undefined) !== (request.generation === undefined)) {
      throw new Error('BROWSER_WORKSPACE_BINDING_INVALID');
    }

    let lastError: unknown = new Error('BROWSER_ENDPOINT_UNAVAILABLE');
    for (const endpoint of [...target.endpoints].sort((a, b) => a.priority - b.priority)) {
      let transport: BrowserMessageTransport | null = null;
      let browser: Browser | null = null;
      let context: BrowserContext | null = null;
      try {
        transport =
          endpoint.via === 'backend'
            ? await DirectBrowserMessageTransport.open(endpoint, signal)
            : await this.tunnels.openBrowserTunnel(
                endpoint,
                {
                  targetId: target.id,
                  targetRevision: target.profileRevision,
                  ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
                  ...(request.generation ? { generation: request.generation } : {}),
                },
                signal,
              );
        const puppeteerTransport = new PuppeteerMessageTransport(transport);
        browser = await puppeteer.connect({
          transport: puppeteerTransport,
          protocol: 'cdp',
          protocolTimeout: PROTOCOL_TIMEOUT_MS,
        });
        if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        page.setDefaultTimeout(PROTOCOL_TIMEOUT_MS);
        page.setDefaultNavigationTimeout(PROTOCOL_TIMEOUT_MS);
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', (pageRequest) => void this.filterRequest(pageRequest, target));
        page.on('popup', (popup) => {
          if (popup) void popup.close().catch(() => undefined);
        });
        const cdp = await page.createCDPSession();
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
        const sessionId = randomUUID();
        const active: ActiveBrowserSession = {
          request: {
            ...request,
            target: {
              ...target,
              endpoints: target.endpoints.map((candidate) => ({ ...candidate })),
              allowedUrlPatterns: [...target.allowedUrlPatterns],
            },
          },
          target,
          transport,
          browser,
          context,
          page,
          cdp,
          createdAt: Math.floor(Date.now() / 1000),
          snapshotId: null,
          nodes: new Map(),
        };
        this.sessions.set(sessionId, active);
        return this.view(sessionId, active);
      } catch (error) {
        lastError = error;
        await context?.close().catch(() => undefined);
        browser?.disconnect();
        await transport?.close().catch(() => undefined);
      }
    }
    throw lastError;
  }

  async getSession(sessionId: string): Promise<BrowserSessionView> {
    return this.view(sessionId, this.requireSession(sessionId));
  }

  async navigate(sessionId: string, value: string, signal: AbortSignal): Promise<BrowserSessionView> {
    const active = this.requireSession(sessionId);
    if (!urlAllowed(value, active.target.allowedUrlPatterns)) throw new Error('BROWSER_URL_DENIED');
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    await active.page.goto(value, { waitUntil: 'domcontentloaded', timeout: PROTOCOL_TIMEOUT_MS });
    this.invalidateSnapshot(active);
    return this.view(sessionId, active);
  }

  async snapshot(
    sessionId: string,
    options: { maxNodes?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserSnapshotView> {
    const active = this.requireSession(sessionId);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (
      !Number.isSafeInteger(maxNodes) ||
      maxNodes < 1 ||
      maxNodes > DEFAULT_MAX_NODES ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > DEFAULT_MAX_BYTES
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const raw = await active.cdp.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includeDOMRects: false,
      includePaintOrder: false,
    });
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const document = raw.documents[0];
    if (!document) throw new Error('BROWSER_SNAPSHOT_UNAVAILABLE');
    const nodes = document.nodes;
    const strings = raw.strings;
    const count = nodes.nodeType?.length ?? 0;
    const childText = new Map<number, string>();
    for (let index = 0; index < count; index += 1) {
      if (nodes.nodeType?.[index] !== 3) continue;
      const parent = nodes.parentIndex?.[index];
      if (typeof parent !== 'number' || parent < 0) continue;
      const text = stringAt(strings, nodes.nodeValue?.[index]);
      if (text.trim()) childText.set(parent, `${childText.get(parent) ?? ''} ${text}`.trim());
    }
    const snapshotId = randomUUID();
    const bindings = new Map<string, NodeBinding>();
    const result: BrowserSnapshotNode[] = [];
    const refByIndex = new Map<number, string>();
    let truncated = false;
    for (let index = 0; index < count; index += 1) {
      if (result.length >= maxNodes) {
        truncated = true;
        break;
      }
      if (nodes.nodeType?.[index] !== 1) continue;
      const backendNodeId = nodes.backendNodeId?.[index];
      if (typeof backendNodeId !== 'number') continue;
      const tag = stringAt(strings, nodes.nodeName?.[index]).toLowerCase();
      const attributes = attributesAt(strings, nodes.attributes?.[index]);
      const text = boundedText(childText.get(index) ?? null);
      const role = roleFor(tag, attributes);
      const name = nodeName(attributes, text);
      const href = boundedText(attributes.get('href') ?? null);
      if (!isVisibleSemanticNode(tag, role, name, href)) continue;
      const nodeRef = `n${result.length + 1}`;
      const parentIndex = nodes.parentIndex?.[index];
      const candidate: BrowserSnapshotNode = {
        nodeRef,
        parentRef: typeof parentIndex === 'number' ? (refByIndex.get(parentIndex) ?? null) : null,
        tag,
        role,
        name,
        text,
        href,
        inputType: boundedText(attributes.get('type') ?? null),
        disabled: attributes.has('disabled') || attributes.get('aria-disabled') === 'true',
      };
      if (Buffer.byteLength(JSON.stringify([...result, candidate]), 'utf8') > maxBytes) {
        truncated = true;
        break;
      }
      result.push(candidate);
      refByIndex.set(index, nodeRef);
      bindings.set(nodeRef, { backendNodeId });
    }
    active.snapshotId = snapshotId;
    active.nodes = bindings;
    return {
      sessionId,
      snapshotId,
      generation: active.request.generation ?? null,
      targetId: active.target.id,
      url: active.page.url(),
      title: boundedText(await active.page.title()) ?? '',
      nodes: result,
      truncated,
    };
  }

  async click(sessionId: string, snapshotId: string, nodeRef: string, signal: AbortSignal): Promise<void> {
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const binding = active.nodes.get(nodeRef)!;
    const model = await active.cdp.send('DOM.getBoxModel', { backendNodeId: binding.backendNodeId });
    const quad = model.model.content;
    if (quad.length < 8) throw new Error('BROWSER_NODE_NOT_INTERACTABLE');
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await active.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await active.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    this.invalidateSnapshot(active);
  }

  async type(sessionId: string, snapshotId: string, nodeRef: string, text: string, signal: AbortSignal): Promise<void> {
    if (Buffer.byteLength(text, 'utf8') > MAX_TYPE_BYTES) throw new Error('BROWSER_INPUT_TOO_LARGE');
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const binding = active.nodes.get(nodeRef)!;
    await active.cdp.send('DOM.focus', { backendNodeId: binding.backendNodeId });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
    if (text) await active.cdp.send('Input.insertText', { text });
    this.invalidateSnapshot(active);
  }

  async close(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) return;
    this.sessions.delete(sessionId);
    await active.cdp.detach().catch(() => undefined);
    await active.context.close().catch(() => undefined);
    active.browser.disconnect();
    await active.transport.close().catch(() => undefined);
  }

  closeWorkspace(workspaceId: string, generation?: number): void {
    for (const [sessionId, active] of this.sessions) {
      if (
        active.request.workspaceId === workspaceId &&
        (generation === undefined || active.request.generation === generation)
      ) {
        void this.close(sessionId);
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }

  private async filterRequest(request: HTTPRequest, target: BrowserTargetSnapshot): Promise<void> {
    try {
      if (urlAllowed(request.url(), target.allowedUrlPatterns)) await request.continue();
      else await request.abort('blockedbyclient');
    } catch {
      // Request may already have completed while the interception decision was being applied.
    }
  }

  private requireSession(sessionId: string): ActiveBrowserSession {
    const active = this.sessions.get(sessionId);
    if (!active) throw new Error('BROWSER_SESSION_NOT_FOUND');
    return active;
  }

  private requireNode(sessionId: string, snapshotId: string, nodeRef: string): ActiveBrowserSession {
    const active = this.requireSession(sessionId);
    if (active.snapshotId !== snapshotId || !active.nodes.has(nodeRef)) throw new Error('BROWSER_NODE_STALE');
    return active;
  }

  private invalidateSnapshot(active: ActiveBrowserSession): void {
    active.snapshotId = null;
    active.nodes.clear();
  }

  private view(sessionId: string, active: ActiveBrowserSession): BrowserSessionView {
    return {
      userId: active.request.userId,
      appId: active.request.appId,
      runId: active.request.runId,
      agentRuntimeId: active.request.agentRuntimeId,
      sessionId,
      targetId: active.target.id,
      targetRevision: active.target.profileRevision,
      workspaceId: active.request.workspaceId ?? null,
      generation: active.request.generation ?? null,
      url: active.page.url(),
      createdAt: active.createdAt,
    };
  }
}

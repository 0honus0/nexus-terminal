import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type ConnectionTransport,
  type HTTPRequest,
  type KeyInput,
  type Page,
} from 'puppeteer-core';
import WebSocket, { type RawData } from 'ws';
import type {
  BrowserEndpointSetting,
  BrowserConsoleEntry,
  BrowserConsoleView,
  BrowserDownloadView,
  BrowserGatewayPort,
  BrowserMessageTransport,
  BrowserPostActionView,
  BrowserSessionRequest,
  BrowserSessionView,
  BrowserScreenshotView,
  BrowserSnapshotNode,
  BrowserSnapshotView,
  BrowserTargetSnapshot,
  BrowserTunnelPort,
} from '../../../modules/agent/ai/integrations.types';

const DEFAULT_MAX_NODES = 2_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSFER_BYTES = 8 * 1024 * 1024;
const MAX_TYPE_BYTES = 16 * 1024;
const MAX_NAME_BYTES = 2 * 1024;
const MAX_SETTLE_MS = 2_000;
const MAX_WAIT_MS = 5_000;
const MAX_SCROLL_DELTA = 10_000;
const MAX_CONSOLE_ENTRIES = 200;
const MAX_CONSOLE_BYTES = 64 * 1024;
const MAX_CONSOLE_ENTRY_BYTES = 4 * 1024;
const MAX_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const DISCOVERY_MAX_BYTES = 64 * 1024;
const DISCOVERY_TIMEOUT_MS = 10_000;
const PROTOCOL_TIMEOUT_MS = 60_000;
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary']);

interface NodeBinding {
  backendNodeId: number;
  tag: string;
  href: string | null;
  inputType: string | null;
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
  consoleSequence: number;
  consoleEntries: BrowserConsoleEntry[];
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

const pngDimensions = (bytes: Uint8Array): { width: number; height: number } => {
  if (
    bytes.byteLength < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    throw new Error('BROWSER_SCREENSHOT_INVALID');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 32768 || height > 32768) throw new Error('BROWSER_SCREENSHOT_INVALID');
  return { width, height };
};

const PRESS_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Space',
]);
const PRESS_MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

const boundedUtf8Text = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result;
};

const consoleType = (value: string): BrowserConsoleEntry['type'] => {
  if (value === 'log' || value === 'debug' || value === 'info' || value === 'error') return value;
  if (value === 'warn' || value === 'warning') return 'warning';
  return 'other';
};

const waitBounded = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const boundedFilename = (value: string): string => {
  const normalized = value
    .replace(/[\\/\0\r\n]/g, '_')
    .replace(/^\.+$/, '_')
    .trim();
  const candidate = normalized || 'download.bin';
  return boundedUtf8Text(candidate, 255) || 'download.bin';
};

const filenameFromDownload = (url: string, contentDisposition: string | null): string => {
  if (contentDisposition) {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
    if (encoded) {
      try {
        return boundedFilename(decodeURIComponent(encoded.replace(/^["']|["']$/g, '')));
      } catch {
        // Fall back to the plain filename/URL path below.
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1];
    if (plain) return boundedFilename(plain);
  }
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).at(-1);
    return boundedFilename(segment ? decodeURIComponent(segment) : 'download.bin');
  } catch {
    return 'download.bin';
  }
};

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
    if (
      !target.endpoints.length ||
      !target.allowedUrlPatterns.length ||
      !/^v1:[0-9a-f]{64}$/.test(target.configurationHash)
    ) {
      throw new Error('BROWSER_TARGET_INVALID');
    }
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
          consoleSequence: 0,
          consoleEntries: [],
        };
        page.on('console', (message) => {
          const location = message.location();
          this.recordConsole(active, {
            type: consoleType(message.type()),
            text: boundedUtf8Text(message.text(), MAX_CONSOLE_ENTRY_BYTES),
            url: location.url ? boundedUtf8Text(location.url, MAX_NAME_BYTES) : null,
            line:
              typeof location.lineNumber === 'number' && Number.isSafeInteger(location.lineNumber)
                ? location.lineNumber
                : null,
            column:
              typeof location.columnNumber === 'number' && Number.isSafeInteger(location.columnNumber)
                ? location.columnNumber
                : null,
          });
        });
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

  async navigate(
    sessionId: string,
    value: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const active = this.requireSession(sessionId);
    if (!urlAllowed(value, active.target.allowedUrlPatterns)) throw new Error('BROWSER_URL_DENIED');
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    await active.page.goto(value, { waitUntil: 'domcontentloaded', timeout: PROTOCOL_TIMEOUT_MS });
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
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
      bindings.set(nodeRef, { backendNodeId, tag, href, inputType: candidate.inputType });
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

  async screenshot(
    sessionId: string,
    options: { maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserScreenshotView> {
    const active = this.requireSession(sessionId);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const maxBytes = options.maxBytes ?? MAX_SCREENSHOT_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SCREENSHOT_BYTES) {
      throw new Error('VALIDATION_FAILED');
    }
    const bytes = await active.page.screenshot({
      type: 'png',
      fullPage: false,
      captureBeyondViewport: false,
    });
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw new Error('BROWSER_SCREENSHOT_TOO_LARGE');
    const dimensions = pngDimensions(bytes);
    return {
      sessionId,
      generation: active.request.generation ?? null,
      targetId: active.target.id,
      url: active.page.url(),
      title: boundedText(await active.page.title()) ?? '',
      mediaType: 'image/png',
      width: dimensions.width,
      height: dimensions.height,
      bytes,
    };
  }

  async click(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    const binding = active.nodes.get(nodeRef)!;
    await active.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: binding.backendNodeId });
    const model = await active.cdp.send('DOM.getBoxModel', { backendNodeId: binding.backendNodeId });
    const quad = model.model.content;
    if (quad.length < 8) throw new Error('BROWSER_NODE_NOT_INTERACTABLE');
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await active.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await active.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async type(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    text: string,
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    if (Buffer.byteLength(text, 'utf8') > MAX_TYPE_BYTES) throw new Error('BROWSER_INPUT_TOO_LARGE');
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    const binding = active.nodes.get(nodeRef)!;
    await active.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: binding.backendNodeId });
    await active.cdp.send('DOM.focus', { backendNodeId: binding.backendNodeId });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
    await active.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
    if (text) await active.cdp.send('Input.insertText', { text });
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async scroll(
    sessionId: string,
    options: { deltaX: number; deltaY: number; settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const active = this.requireSession(sessionId);
    if (
      !Number.isFinite(options.deltaX) ||
      !Number.isFinite(options.deltaY) ||
      Math.abs(options.deltaX) > MAX_SCROLL_DELTA ||
      Math.abs(options.deltaY) > MAX_SCROLL_DELTA
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    await active.page.mouse.wheel({ deltaX: options.deltaX, deltaY: options.deltaY });
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async press(
    sessionId: string,
    options: {
      key: string;
      modifiers?: string[];
      snapshotId?: string;
      nodeRef?: string;
      settleMs?: number;
    },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const hasNode = options.nodeRef !== undefined || options.snapshotId !== undefined;
    if ((options.nodeRef === undefined) !== (options.snapshotId === undefined)) throw new Error('VALIDATION_FAILED');
    if (!PRESS_KEYS.has(options.key) && !/^Key[A-Z]$/.test(options.key) && !/^Digit[0-9]$/.test(options.key)) {
      throw new Error('VALIDATION_FAILED');
    }
    const modifiers = [...new Set(options.modifiers ?? [])];
    if (modifiers.some((modifier) => !PRESS_MODIFIERS.has(modifier))) throw new Error('VALIDATION_FAILED');
    const active = hasNode
      ? this.requireNode(sessionId, options.snapshotId!, options.nodeRef!)
      : this.requireSession(sessionId);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    if (hasNode) {
      const binding = active.nodes.get(options.nodeRef!)!;
      await active.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: binding.backendNodeId });
      await active.cdp.send('DOM.focus', { backendNodeId: binding.backendNodeId });
    }
    for (const modifier of modifiers) await active.page.keyboard.down(modifier as KeyInput);
    try {
      await active.page.keyboard.press(options.key as KeyInput);
    } finally {
      for (const modifier of [...modifiers].reverse()) await active.page.keyboard.up(modifier as KeyInput);
    }
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async back(sessionId: string, options: { settleMs?: number }, signal: AbortSignal): Promise<BrowserPostActionView> {
    const active = this.requireSession(sessionId);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    await active.page.goBack({ waitUntil: 'domcontentloaded', timeout: PROTOCOL_TIMEOUT_MS });
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async select(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    values: string[],
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    if (values.length < 1 || values.length > 16 || values.some((value) => Buffer.byteLength(value, 'utf8') > 512)) {
      throw new Error('VALIDATION_FAILED');
    }
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    const binding = active.nodes.get(nodeRef)!;
    if (binding.tag !== 'select') throw new Error('BROWSER_NODE_NOT_SELECT');
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    const resolved = await active.cdp.send('DOM.resolveNode', { backendNodeId: binding.backendNodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error('BROWSER_NODE_NOT_INTERACTABLE');
    const called = await active.cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function(values){if(!(this instanceof HTMLSelectElement))throw new Error("not-select");const wanted=new Set(values);const matched=new Set();for(const option of this.options){const selected=wanted.has(option.value);option.selected=selected;if(selected)matched.add(option.value);}if(matched.size!==wanted.size)throw new Error("option-not-found");if(!this.multiple&&matched.size>1){let seen=false;for(const option of this.options){if(option.selected){if(seen)option.selected=false;else seen=true;}}}this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));return Array.from(this.selectedOptions).map((option)=>option.value);}',
      arguments: [{ value: values }],
      returnByValue: true,
      awaitPromise: false,
      userGesture: true,
    });
    if (called.exceptionDetails) throw new Error('BROWSER_SELECT_FAILED');
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async wait(
    sessionId: string,
    options: { mode: 'timeout' | 'networkIdle'; maxMillis: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const active = this.requireSession(sessionId);
    if (!Number.isSafeInteger(options.maxMillis) || options.maxMillis < 1 || options.maxMillis > MAX_WAIT_MS) {
      throw new Error('VALIDATION_FAILED');
    }
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    if (options.mode === 'timeout') {
      await waitBounded(options.maxMillis, signal);
    } else if (options.mode === 'networkIdle') {
      try {
        await active.page.waitForNetworkIdle({
          idleTime: Math.min(250, options.maxMillis),
          timeout: options.maxMillis,
        });
      } catch {
        if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
        throw new Error('BROWSER_WAIT_TIMEOUT');
      }
    } else {
      throw new Error('VALIDATION_FAILED');
    }
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, 0, signal);
  }

  async console(
    sessionId: string,
    options: { afterCursor?: number; limit?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserConsoleView> {
    const active = this.requireSession(sessionId);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const afterCursor = options.afterCursor ?? 0;
    const limit = options.limit ?? 50;
    const maxBytes = options.maxBytes ?? 16 * 1024;
    if (
      !Number.isSafeInteger(afterCursor) ||
      afterCursor < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 256 ||
      maxBytes > MAX_CONSOLE_BYTES
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const firstAvailable = active.consoleEntries[0]?.sequence ?? active.consoleSequence + 1;
    let bytes = 0;
    let truncated = afterCursor < firstAvailable - 1;
    let nextCursor = afterCursor;
    const entries: BrowserConsoleEntry[] = [];
    const eligible = active.consoleEntries.filter((entry) => entry.sequence > afterCursor);
    for (const entry of eligible) {
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
      if (entries.length > 0 && bytes + entryBytes > maxBytes) {
        truncated = true;
        break;
      }
      if (entryBytes > maxBytes) {
        truncated = true;
        nextCursor = entry.sequence;
        continue;
      }
      entries.push(entry);
      bytes += entryBytes;
      nextCursor = entry.sequence;
    }
    if (nextCursor < (eligible.at(-1)?.sequence ?? afterCursor)) truncated = true;
    return {
      sessionId,
      entries,
      nextCursor,
      truncated,
    };
  }

  async upload(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    file: { name: string; mediaType: string; bytes: Uint8Array },
    options: { settleMs?: number },
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    if (
      file.bytes.byteLength > MAX_TRANSFER_BYTES ||
      Buffer.byteLength(file.name, 'utf8') > 255 ||
      Buffer.byteLength(file.mediaType, 'utf8') > 128
    ) {
      throw new Error('BROWSER_UPLOAD_TOO_LARGE');
    }
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    const binding = active.nodes.get(nodeRef)!;
    if (binding.tag !== 'input' || binding.inputType !== 'file') throw new Error('BROWSER_NODE_NOT_FILE_INPUT');
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const beforeUrl = active.page.url();
    const resolved = await active.cdp.send('DOM.resolveNode', { backendNodeId: binding.backendNodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error('BROWSER_NODE_NOT_INTERACTABLE');
    const called = await active.cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function(base64,name,mediaType){if(!(this instanceof HTMLInputElement)||this.type!=="file")throw new Error("not-file-input");const binary=atob(base64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);const file=new File([bytes],name,{type:mediaType});const transfer=new DataTransfer();transfer.items.add(file);this.files=transfer.files;this.dispatchEvent(new Event("input",{bubbles:true}));this.dispatchEvent(new Event("change",{bubbles:true}));return {count:this.files?.length??0,name:this.files?.[0]?.name??""};}',
      arguments: [
        { value: Buffer.from(file.bytes).toString('base64') },
        { value: file.name },
        { value: file.mediaType },
      ],
      returnByValue: true,
      awaitPromise: false,
      userGesture: true,
    });
    if (called.exceptionDetails) throw new Error('BROWSER_UPLOAD_FAILED');
    this.invalidateSnapshot(active);
    return this.postAction(sessionId, active, beforeUrl, options.settleMs, signal);
  }

  async download(
    sessionId: string,
    snapshotId: string,
    nodeRef: string,
    options: { maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserDownloadView> {
    const active = this.requireNode(sessionId, snapshotId, nodeRef);
    const binding = active.nodes.get(nodeRef)!;
    if (!binding.href || (binding.tag !== 'a' && binding.tag !== 'area')) throw new Error('BROWSER_NODE_NOT_DOWNLOAD');
    const maxBytes = options.maxBytes ?? MAX_TRANSFER_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_TRANSFER_BYTES) {
      throw new Error('VALIDATION_FAILED');
    }
    const url = new URL(binding.href, active.page.url()).toString();
    if (!urlAllowed(url, active.target.allowedUrlPatterns)) throw new Error('BROWSER_URL_DENIED');
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    let payload: {
      ok: boolean;
      error?: string;
      url?: string;
      mediaType?: string;
      disposition?: string | null;
      base64?: string;
    };
    try {
      payload = await active.page.evaluate(
        async ({ targetUrl, ceiling }) => {
          const response = await fetch(targetUrl, { credentials: 'include', redirect: 'follow' });
          if (!response.ok) return { ok: false, error: `http-${response.status}` };
          const reader = response.body?.getReader();
          if (!reader) return { ok: false, error: 'body-unavailable' };
          const chunks: Uint8Array[] = [];
          let total = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            if (!next.value) continue;
            total += next.value.byteLength;
            if (total > ceiling) {
              await reader.cancel();
              return { ok: false, error: 'too-large' };
            }
            chunks.push(next.value);
          }
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          let binary = '';
          for (let index = 0; index < merged.length; index += 0x8000) {
            binary += String.fromCharCode(...merged.subarray(index, Math.min(index + 0x8000, merged.length)));
          }
          return {
            ok: true,
            url: response.url,
            mediaType:
              response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream',
            disposition: response.headers.get('content-disposition'),
            base64: btoa(binary),
          };
        },
        { targetUrl: url, ceiling: maxBytes },
      );
    } catch {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      throw new Error('BROWSER_DOWNLOAD_FAILED');
    }
    if (!payload.ok) {
      if (payload.error === 'too-large') throw new Error('BROWSER_DOWNLOAD_TOO_LARGE');
      throw new Error('BROWSER_DOWNLOAD_FAILED');
    }
    if (
      !payload.url ||
      payload.base64 === undefined ||
      !urlAllowed(payload.url, active.target.allowedUrlPatterns) ||
      !payload.mediaType ||
      payload.mediaType.length > 128 ||
      /[\r\n\0]/.test(payload.mediaType)
    ) {
      throw new Error('BROWSER_DOWNLOAD_INVALID');
    }
    const bytes = Buffer.from(payload.base64, 'base64');
    if (bytes.byteLength > maxBytes) throw new Error('BROWSER_DOWNLOAD_INVALID');
    return {
      sessionId,
      generation: active.request.generation ?? null,
      targetId: active.target.id,
      url: payload.url,
      name: filenameFromDownload(payload.url, payload.disposition ?? null),
      mediaType: payload.mediaType,
      bytes,
    };
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

  private async postAction(
    sessionId: string,
    active: ActiveBrowserSession,
    beforeUrl: string,
    settleMs: number | undefined,
    signal: AbortSignal,
  ): Promise<BrowserPostActionView> {
    const boundedSettle = settleMs ?? 250;
    if (!Number.isSafeInteger(boundedSettle) || boundedSettle < 0 || boundedSettle > MAX_SETTLE_MS) {
      throw new Error('VALIDATION_FAILED');
    }
    if (boundedSettle > 0) {
      try {
        await active.page.waitForNetworkIdle({
          idleTime: Math.min(100, boundedSettle),
          timeout: boundedSettle,
        });
      } catch {
        // Post-action settle is best-effort and bounded; explicit browser_wait provides strict waiting.
      }
    }
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const url = active.page.url();
    return {
      sessionId,
      generation: active.request.generation ?? null,
      targetId: active.target.id,
      url,
      title: boundedText(await active.page.title()) ?? '',
      navigationChanged: url !== beforeUrl,
    };
  }

  private recordConsole(active: ActiveBrowserSession, entry: Omit<BrowserConsoleEntry, 'sequence'>): void {
    active.consoleSequence += 1;
    active.consoleEntries.push({ sequence: active.consoleSequence, ...entry });
    while (
      active.consoleEntries.length > MAX_CONSOLE_ENTRIES ||
      Buffer.byteLength(JSON.stringify(active.consoleEntries), 'utf8') > MAX_CONSOLE_BYTES
    ) {
      active.consoleEntries.shift();
    }
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
      targetConfigurationHash: active.target.configurationHash,
      workspaceId: active.request.workspaceId ?? null,
      generation: active.request.generation ?? null,
      url: active.page.url(),
      createdAt: active.createdAt,
    };
  }
}

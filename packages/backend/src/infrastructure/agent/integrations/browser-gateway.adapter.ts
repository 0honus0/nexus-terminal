import { randomUUID } from 'node:crypto';
import puppeteer, { type Browser, type BrowserContext, type CDPSession, type Page } from 'puppeteer-core';
import type { OutboundPolicyPort } from '../../../modules/agent/ai/outbound-policy.port';
import type {
  BrowserEndpointBinding,
  BrowserEndpointPort,
  BrowserGatewayPort,
  BrowserSessionRequest,
  BrowserSessionView,
  BrowserSnapshotNode,
  BrowserSnapshotView,
} from '../../../modules/agent/ai/integrations.types';

const DEFAULT_MAX_NODES = 2_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_TYPE_BYTES = 16 * 1024;
const MAX_NAME_BYTES = 2 * 1024;
const PROTOCOL_TIMEOUT_MS = 60_000;
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary']);

interface NodeBinding {
  backendNodeId: number;
}

interface ActiveBrowserSession {
  request: BrowserSessionRequest;
  binding: BrowserEndpointBinding;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  createdAt: number;
  snapshotId: string | null;
  nodes: Map<string, NodeBinding>;
}

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

const normalizeHost = (value: string): string => value.trim().toLowerCase().replace(/\.$/, '');

export class PuppeteerBrowserGateway implements BrowserGatewayPort {
  private readonly sessions = new Map<string, ActiveBrowserSession>();

  constructor(
    private readonly endpoints: BrowserEndpointPort,
    private readonly outboundPolicy: OutboundPolicyPort,
  ) {}

  async createSession(request: BrowserSessionRequest, signal: AbortSignal): Promise<BrowserSessionView> {
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    const binding = await this.endpoints.open(request, signal);
    if (
      binding.environmentId !== request.environmentId ||
      !Number.isSafeInteger(binding.generation) ||
      binding.generation < 1
    ) {
      await binding.close().catch(() => undefined);
      throw new Error('BROWSER_ENVIRONMENT_BINDING_INVALID');
    }
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: binding.browserWSEndpoint,
        protocol: 'cdp',
        protocolTimeout: PROTOCOL_TIMEOUT_MS,
      });
      context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.setDefaultTimeout(PROTOCOL_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PROTOCOL_TIMEOUT_MS);
      const cdp = await page.createCDPSession();
      const sessionId = randomUUID();
      const createdAt = Math.floor(Date.now() / 1000);
      this.sessions.set(sessionId, {
        request,
        binding,
        browser,
        context,
        page,
        cdp,
        createdAt,
        snapshotId: null,
        nodes: new Map(),
      });
      return this.view(sessionId, this.sessions.get(sessionId)!);
    } catch (error) {
      await context?.close().catch(() => undefined);
      browser?.disconnect();
      await binding.close().catch(() => undefined);
      throw error;
    }
  }

  async navigate(sessionId: string, url: string, signal: AbortSignal): Promise<BrowserSessionView> {
    const active = this.requireSession(sessionId);
    this.assertGeneration(active);
    const destination = await this.allowedNavigation(active, url);
    if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
    await active.page.goto(destination.toString(), { waitUntil: 'domcontentloaded', timeout: PROTOCOL_TIMEOUT_MS });
    this.invalidateSnapshot(active);
    return this.view(sessionId, active);
  }

  async snapshot(
    sessionId: string,
    options: { maxNodes?: number; maxBytes?: number },
    signal: AbortSignal,
  ): Promise<BrowserSnapshotView> {
    const active = this.requireSession(sessionId);
    this.assertGeneration(active);
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
      const value = stringAt(strings, nodes.nodeValue?.[index]);
      if (!value.trim()) continue;
      childText.set(parent, `${childText.get(parent) ?? ''} ${value}`.trim());
    }

    const snapshotId = randomUUID();
    const bindings = new Map<string, NodeBinding>();
    const resultNodes: BrowserSnapshotNode[] = [];
    const refByIndex = new Map<number, string>();
    let truncated = false;
    for (let index = 0; index < count; index += 1) {
      if (resultNodes.length >= maxNodes) {
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
      const nodeRef = `n${resultNodes.length + 1}`;
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
      const next = [...resultNodes, candidate];
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > maxBytes) {
        truncated = true;
        break;
      }
      resultNodes.push(candidate);
      refByIndex.set(index, nodeRef);
      bindings.set(nodeRef, { backendNodeId });
    }
    active.snapshotId = snapshotId;
    active.nodes = bindings;
    const title = boundedText(await active.page.title()) ?? '';
    return {
      sessionId,
      snapshotId,
      generation: active.binding.generation,
      url: active.page.url(),
      title,
      nodes: resultNodes,
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
    await active.binding.close().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }

  private requireSession(sessionId: string): ActiveBrowserSession {
    const active = this.sessions.get(sessionId);
    if (!active) throw new Error('BROWSER_SESSION_NOT_FOUND');
    return active;
  }

  private requireNode(sessionId: string, snapshotId: string, nodeRef: string): ActiveBrowserSession {
    const active = this.requireSession(sessionId);
    this.assertGeneration(active);
    if (active.snapshotId !== snapshotId || !active.nodes.has(nodeRef)) throw new Error('BROWSER_NODE_STALE');
    return active;
  }

  private assertGeneration(active: ActiveBrowserSession): void {
    if (!Number.isSafeInteger(active.binding.generation) || active.binding.generation < 1) {
      throw new Error('BROWSER_ENVIRONMENT_STALE');
    }
  }

  private invalidateSnapshot(active: ActiveBrowserSession): void {
    active.snapshotId = null;
    active.nodes.clear();
  }

  private view(sessionId: string, active: ActiveBrowserSession): BrowserSessionView {
    return {
      sessionId,
      environmentId: active.binding.environmentId,
      generation: active.binding.generation,
      url: active.page.url(),
      createdAt: active.createdAt,
    };
  }

  private async allowedNavigation(active: ActiveBrowserSession, value: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('BROWSER_URL_INVALID');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('BROWSER_URL_DENIED');
    const allowed = new Set(active.binding.allowedHosts.map(normalizeHost));
    const hostname = normalizeHost(url.hostname);
    const host = normalizeHost(url.host);
    if (!allowed.has(hostname) && !allowed.has(host)) throw new Error('BROWSER_HOST_DENIED');
    await this.outboundPolicy.resolve(url.toString(), []);
    return url;
  }
}

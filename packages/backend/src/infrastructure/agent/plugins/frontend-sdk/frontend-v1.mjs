const PROTOCOL_VERSION = 1;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_MESSAGE_BYTES = 256_000;
const encoder = new TextEncoder();

const serializedBytes = (value) => {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const randomId = () => crypto.randomUUID();

const connect = () =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error('NEXUS_PLUGIN_CONNECT_TIMEOUT')), REQUEST_TIMEOUT_MS);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      value instanceof Error ? reject(value) : resolve(value);
    };
    const onMessage = (event) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return;
      if (event.data.type !== 'nexus.plugin.init' || event.data.protocol !== PROTOCOL_VERSION) return;
      if (typeof event.data.nonce !== 'string' || event.data.nonce.length < 16 || event.ports.length !== 1) {
        finish(new Error('NEXUS_PLUGIN_PROTOCOL_INVALID'));
        return;
      }
      const port = event.ports[0];
      port.start();
      port.postMessage({ type: 'nexus.plugin.ack', protocol: PROTOCOL_VERSION, nonce: event.data.nonce, seq: 0 });
      finish({ port, nonce: event.data.nonce });
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'nexus.plugin.ready', protocol: PROTOCOL_VERSION }, '*');
  });

const createSdk = ({ port, nonce }) => {
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const runListeners = new Map();
  const bufferedRunEvents = new Map();

  const failAll = (code) => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      window.clearTimeout(request.timer);
      request.reject(new Error(code));
    }
    pending.clear();
    runListeners.clear();
    bufferedRunEvents.clear();
    port.close();
  };

  const request = (method, params = {}) => {
    if (closed) return Promise.reject(new Error('NEXUS_PLUGIN_SDK_CLOSED'));
    const id = randomId();
    const seq = ++sequence;
    const message = { type: 'nexus.plugin.request', protocol: PROTOCOL_VERSION, nonce, seq, id, method, params };
    if (serializedBytes(message) > MAX_MESSAGE_BYTES)
      return Promise.reject(new Error('NEXUS_PLUGIN_REQUEST_TOO_LARGE'));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('NEXUS_PLUGIN_REQUEST_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { seq, resolve, reject, timer });
      port.postMessage(message);
    });
  };

  const onMessage = (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object' || serializedBytes(message) > MAX_MESSAGE_BYTES) {
      failAll('NEXUS_PLUGIN_PROTOCOL_INVALID');
      return;
    }
    if (message.protocol !== PROTOCOL_VERSION || message.nonce !== nonce) {
      failAll('NEXUS_PLUGIN_PROTOCOL_INVALID');
      return;
    }
    if (message.type === 'nexus.plugin.event' && message.channel === 'agent.run') {
      if (typeof message.subscriptionId !== 'string') return;
      const listener = runListeners.get(message.subscriptionId);
      if (listener) listener(message.event);
      else {
        const buffered = bufferedRunEvents.get(message.subscriptionId) ?? [];
        if (buffered.length < 32) buffered.push(message.event);
        bufferedRunEvents.set(message.subscriptionId, buffered);
      }
      return;
    }
    if (message.type !== 'nexus.plugin.response' || typeof message.id !== 'string') return;
    const active = pending.get(message.id);
    if (!active || message.seq !== active.seq) return;
    pending.delete(message.id);
    window.clearTimeout(active.timer);
    if (message.ok === true) active.resolve(message.result);
    else active.reject(new Error(message.error?.code || 'NEXUS_PLUGIN_REQUEST_FAILED'));
  };

  port.addEventListener('message', onMessage);
  port.addEventListener('messageerror', () => failAll('NEXUS_PLUGIN_PROTOCOL_INVALID'));

  const subscribeRun = async (runId, onEvent, cursor = 0) => {
    if (typeof onEvent !== 'function') throw new Error('NEXUS_PLUGIN_EVENT_HANDLER_REQUIRED');
    const result = await request('agent.runs.subscribe', { runId, cursor });
    const subscriptionId = result?.subscriptionId;
    if (typeof subscriptionId !== 'string') throw new Error('NEXUS_PLUGIN_PROTOCOL_INVALID');
    runListeners.set(subscriptionId, onEvent);
    const buffered = bufferedRunEvents.get(subscriptionId) ?? [];
    bufferedRunEvents.delete(subscriptionId);
    for (const event of buffered) onEvent(event);
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      runListeners.delete(subscriptionId);
      bufferedRunEvents.delete(subscriptionId);
      await request('agent.runs.unsubscribe', { subscriptionId }).catch(() => undefined);
    };
  };

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    host: Object.freeze({ appInfo: () => request('host.appInfo') }),
    storage: Object.freeze({
      get: (key) => request('storage.get', { key }),
      put: (key, value, expectedVersion = null) => request('storage.put', { key, value, expectedVersion }),
      delete: (key, expectedVersion) => request('storage.delete', { key, expectedVersion }),
    }),
    agent: Object.freeze({
      definitions: Object.freeze({ list: () => request('agent.definitions.list') }),
      providers: Object.freeze({ list: () => request('agent.providers.list') }),
      threads: Object.freeze({
        list: (before) => request('agent.threads.list', before === undefined ? {} : { before }),
        create: (title) => request('agent.threads.create', title === undefined ? {} : { title }),
        entries: (threadId, before) =>
          request('agent.threads.entries', before === undefined ? { threadId } : { threadId, before }),
      }),
      runs: Object.freeze({
        list: (threadId) => request('agent.runs.list', threadId === undefined ? {} : { threadId }),
        get: (runId) => request('agent.runs.get', { runId }),
        create: (input) => request('agent.runs.create', input),
        appendInput: (runId, text, artifactRefs = []) =>
          request('agent.runs.appendInput', { runId, text, artifactRefs }),
        cancel: (runId) => request('agent.runs.cancel', { runId }),
        subscribe: subscribeRun,
      }),
      subagents: Object.freeze({
        list: (runId, before) => request('agent.subagents.list', before === undefined ? { runId } : { runId, before }),
        messages: (runId, delegationId, before) =>
          request(
            'agent.subagents.messages',
            before === undefined ? { runId, delegationId } : { runId, delegationId, before },
          ),
        cancel: (runId, delegationId) => request('agent.subagents.cancel', { runId, delegationId }),
      }),
      approvals: Object.freeze({
        list: (runId) => request('agent.approvals.list', { runId }),
        resolve: (approvalId, runId, decision) => request('agent.approvals.resolve', { approvalId, runId, decision }),
      }),
    }),
    close: () => failAll('NEXUS_PLUGIN_SDK_CLOSED'),
  });
};

let singleton;

export const connectNexusPlugin = async () => {
  singleton ??= connect().then(createSdk);
  return singleton;
};

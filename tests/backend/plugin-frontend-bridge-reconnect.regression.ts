import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath: string): string => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const slice = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `expected source slice ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
};

const bridge = read('packages/frontend/src/features/agent/plugin-sdk/host-bridge.ts');

const constructor = slice(bridge, 'constructor(', 'start(): Promise<void>');
assert(
  constructor.includes('private readonly onDisconnected?: () => void'),
  'bridge must expose a post-handshake disconnect lifecycle callback',
);

const closeLifecycle = slice(bridge, 'close(): void', 'private readonly onWindowMessage');
assert(
  closeLifecycle.includes('this.closeInternal(false);'),
  'public close must remain an intentional shutdown that does not request reconnect',
);
assert(
  closeLifecycle.includes('private disconnect(): void') && closeLifecycle.includes('this.closeInternal(true);'),
  'unexpected transport shutdown must use the notifying disconnect path',
);
assert(
  closeLifecycle.includes('const wasConnected = this.connected;'),
  'disconnect notification must distinguish post-handshake disconnect from handshake failure',
);
assert(
  closeLifecycle.includes('if (notifyDisconnected && wasConnected)'),
  'disconnect callback must fire only after a completed handshake',
);

const portError = slice(bridge, 'private readonly onPortError', 'private readonly onPortMessage');
assert(portError.includes('this.disconnect();'), 'MessagePort messageerror must notify the host surface after ready');

const portMessage = slice(bridge, 'private readonly onPortMessage', 'private validRequest');
assert(
  !portMessage.includes('this.close();'),
  'protocol/nonce/sequence violations must not bypass post-handshake lifecycle notification',
);
assert(
  portMessage.split('this.disconnect();').length - 1 >= 3,
  'oversize/protocol/ack/request violations must all terminate through disconnect()',
);

const post = slice(bridge, 'private post(', 'private failHandshake');
assert(
  post.includes('catch {\n        this.disconnect();'),
  'MessagePort post failures must transition the host out of ready state',
);

const failHandshake = slice(bridge, 'private failHandshake', '\n}');
assert(
  failHandshake.includes('this.close();'),
  'pre-ready handshake failure should still use intentional close after rejecting start()',
);

const frame = read('packages/frontend/src/features/agent/host/PluginAppFrame.vue');
assert(
  frame.includes('let suppressedFrameLoad: HTMLIFrameElement | null = null;'),
  'host-initiated iframe navigation must be tracked by concrete frame identity',
);

const load = slice(frame, 'const load = async', 'const onFrameLoad =');
assert(
  load.includes('new PluginFrontendHostBridge(frame, props.appId, next, () => {'),
  'PluginAppFrame must subscribe to bridge post-handshake disconnects',
);
assert(
  load.includes('if (current !== generation || bridge !== nextBridge) return;'),
  'disconnect recovery must be generation/bridge identity guarded',
);
assert(
  load.includes('queueMicrotask(() => {') &&
    load.includes('if (current === generation && bridge === nextBridge) void load();'),
  'unexpected disconnect must rebuild the full descriptor/iframe/bridge lifecycle without reentrant close',
);
assert(
  load.indexOf('suppressedFrameLoad = frame;') < load.indexOf('frame.src = next.url;'),
  'host navigation suppression must be armed before assigning iframe src',
);

const frameLoad = slice(frame, 'const onFrameLoad =', 'watch(');
assert(
  frameLoad.includes('event.currentTarget') && frameLoad.includes('suppressedFrameLoad === loadedFrame'),
  'iframe load suppression must be scoped to the exact host-navigated frame',
);
assert(
  frameLoad.includes("if (status.value !== 'ready' || !descriptor.value) return;"),
  'initial/connecting host loads must not recursively rebuild the iframe',
);
assert(
  frameLoad.includes('void load();'),
  'an external iframe reload after ready must trigger a full generation-safe reconnect',
);
assert(frame.includes('@load="onFrameLoad"'), 'iframe lifecycle must be wired to the reconnect handler');

process.stdout.write('plugin frontend bridge reconnect regression: PASS\n');

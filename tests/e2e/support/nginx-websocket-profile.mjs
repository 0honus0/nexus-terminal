import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(path.resolve('packages/backend/package.json'));
const { WebSocket, WebSocketServer } = require('ws');
const unified = process.env.NEXUS_PROFILE_UNIFIED_IMAGE;
const image = unified ?? 'nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94';
const configTarget =
  process.env.NEXUS_PROFILE_CONFIG_TARGET ??
  (unified ? '/etc/nginx/http.d/default.conf' : '/etc/nginx/conf.d/default.conf');
const identity = `nexus-ws-profile-${crypto.randomUUID()}`;
const directory = path.join('/tmp/opencode', identity);
await mkdir(directory, { mode: 0o755 });
const unixServer = createServer();
const directServer = createServer();
const peers = new Set();
const bursts = new Map();
const burstBlock = crypto.randomBytes(1024 * 1024);
const tcp = process.env.NEXUS_PROFILE_TCP === '1';
if (tcp) for (let index = 0; index < burstBlock.length; index++) burstBlock[index] = index % 251;
for (const server of [unixServer, directServer]) {
  const websocketServer = new WebSocketServer({ server, perMessageDeflate: false });
  websocketServer.on('connection', (socket) => {
    peers.add(socket);
    socket.once('close', () => peers.delete(socket));
    socket.on('message', (bytes, binary) => {
      if (!binary && bursts.has(bytes.toString())) {
        const started = bursts.get(bytes.toString());
        for (let index = 0; index < 8; index++) socket.send(burstBlock, { binary: true });
        started(socket);
        return;
      }
      socket.send(bytes, { binary });
    });
  });
}
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const withinDeadline = async (work, message) => {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
let container;
let upstreamContainer;
let network;
let upstreamOrigin;
const waitForSession = async (token, field) => {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const state = await (await fetch(`${upstreamOrigin}/${token}`, { signal: AbortSignal.timeout(1000) })).json();
    if (state?.[field]) return;
    await delay(10);
  }
  throw new Error(`TCP upstream session did not reach ${field}`);
};
try {
  unixServer.listen(path.join(directory, 'upstream.sock'));
  await once(unixServer, 'listening');
  await chmod(path.join(directory, 'upstream.sock'), 0o777);
  directServer.listen(0, '127.0.0.1');
  await once(directServer, 'listening');
  if (tcp) {
    network = docker('network', 'create', '--label', `nexus.profile.identity=${identity}`, identity);
    upstreamContainer = docker(
      'run',
      '-d',
      '--name',
      `${identity}-upstream`,
      '--network',
      network,
      '--network-alias',
      'backend',
      '--label',
      `nexus.profile.identity=${identity}`,
      '-p',
      '127.0.0.1::3001',
      '-v',
      `${process.cwd()}:/workspace:ro`,
      'node:20-bookworm',
      'node',
      '/workspace/tests/e2e/support/nginx-websocket-upstream.mjs',
    );
    const upstreamInspection = docker('inspect', upstreamContainer);
    await writeFile(path.join(directory, 'upstream-inspect.json'), upstreamInspection);
    const upstreamBinding = JSON.parse(upstreamInspection)[0].NetworkSettings.Ports['3001/tcp']?.[0];
    assert.ok(upstreamBinding, `TCP fixture did not publish its port; artifacts: ${directory}`);
    assert.equal(upstreamBinding.HostIp, '127.0.0.1');
    const port = upstreamBinding.HostPort;
    upstreamOrigin = `http://127.0.0.1:${port}`;
    const deadline = performance.now() + 10_000;
    let ready = false;
    while (!ready && performance.now() < deadline) {
      try {
        ready = (await fetch(upstreamOrigin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        await delay(10);
      }
    }
    assert.ok(ready, `TCP fixture did not become ready; artifacts: ${directory}`);
  }
  const production = await readFile('packages/frontend/nginx.conf', 'utf8');
  const config = production
    .replaceAll('server backend:3001;', tcp ? 'server backend:3001;' : 'server unix:/fixture/upstream.sock;')
    .replaceAll('proxy_pass http://backend:3001;', 'proxy_pass http://nexus_backend;');
  await writeFile(path.join(directory, 'default.conf'), config);
  const validation = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      tcp ? network : 'none',
      '--label',
      `nexus.profile.identity=${identity}`,
      '-v',
      `${directory}:/fixture:ro`,
      '-v',
      `${directory}/default.conf:${configTarget}:ro`,
      ...(unified ? ['--entrypoint', 'nginx'] : []),
      image,
      ...(unified ? [] : ['nginx']),
      '-t',
    ],
    { encoding: 'utf8' },
  );
  await writeFile(
    path.join(directory, 'config-validation.log'),
    `${validation.stdout ?? ''}${validation.stderr ?? ''}${validation.error?.message ?? ''}`,
  );
  assert.equal(validation.status, 0, `nginx configuration validation failed; artifacts: ${directory}`);
  container = docker(
    'run',
    '-d',
    '--name',
    identity,
    ...(tcp ? ['--network', network] : []),
    '--label',
    `nexus.profile.identity=${identity}`,
    '-p',
    '127.0.0.1::80',
    '-v',
    `${directory}:/fixture`,
    '-v',
    `${directory}/default.conf:${configTarget}:ro`,
    ...(unified ? ['--entrypoint', 'nginx'] : []),
    image,
    ...(unified ? ['-g', 'daemon off;'] : []),
  );
  const binding = JSON.parse(docker('inspect', container))[0].NetworkSettings.Ports['80/tcp']?.[0];
  assert.ok(binding, `nginx did not publish its fixture port; artifacts: ${directory}`);
  const proxyOrigin = `http://127.0.0.1:${binding.HostPort}`;
  // A bounded readiness probe; no product timeout or retry policy is modified.
  const deadline = performance.now() + 10_000;
  let ready = false;
  while (!ready && performance.now() < deadline) {
    try {
      ready = (await fetch(proxyOrigin, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* container listener is starting */
    }
  }
  assert.ok(ready, 'isolated nginx must become ready');
  const samples = [];
  for (const [route, url] of [
    [
      'direct',
      tcp
        ? `${upstreamOrigin.replace('http:', 'ws:')}/ws/profile`
        : `ws://127.0.0.1:${directServer.address().port}/ws/profile`,
    ],
    ['nginx', `ws://127.0.0.1:${binding.HostPort}/ws/profile`],
  ]) {
    for (let sample = 0; sample < 3; sample++) {
      const socket = new WebSocket(url, { perMessageDeflate: false });
      await once(socket, 'open');
      try {
        const exchange = async (payload) => {
          const received = once(socket, 'message');
          socket.send(payload);
          const [bytes, binary] = await received;
          assert.equal(binary, true);
          assert.deepEqual(bytes, payload);
        };
        const small = Buffer.alloc(64, 0x51);
        const roundtrips = [];
        for (let index = 0; index < 100; index++) {
          const start = performance.now();
          await exchange(small);
          roundtrips.push(performance.now() - start);
        }
        const block = crypto.randomBytes(1024 * 1024);
        const start = performance.now();
        for (let index = 0; index < 16; index++) await exchange(block);
        roundtrips.sort((a, b) => a - b);
        samples.push({ route, sample, roundtripMedianMs: roundtrips[50], sixteenMiBEchoMs: performance.now() - start });
      } finally {
        const closed = once(socket, 'close');
        socket.close();
        await closed;
      }
    }
  }
  const recovery = [];
  for (const abort of [false, true]) {
    const socket = new WebSocket(`ws://127.0.0.1:${binding.HostPort}/ws/profile`, { perMessageDeflate: false });
    await once(socket, 'open', { signal: AbortSignal.timeout(10_000) });
    const token = crypto.randomUUID();
    let resolveStarted;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    bursts.set(token, resolveStarted);
    let received = 0;
    let resolveReceived;
    const complete = new Promise((resolve) => {
      resolveReceived = resolve;
    });
    socket.on('message', (bytes, binary) => {
      assert.equal(binary, true);
      assert.deepEqual(bytes, burstBlock);
      received++;
      if (received === 8) resolveReceived();
    });
    try {
      socket.pause();
      socket.send(token);
      const peer = tcp
        ? await waitForSession(token, 'started')
        : await withinDeadline(started, 'burst upstream did not start');
      const peerClosed = tcp ? undefined : once(peer, 'close', { signal: AbortSignal.timeout(10_000) });
      await delay(100);
      assert.equal(received, 0, 'paused consumer must not deliver messages');
      const start = performance.now();
      if (abort) {
        const closed = once(socket, 'close', { signal: AbortSignal.timeout(10_000) });
        socket.terminate();
        await closed;
      } else {
        socket.resume();
        await withinDeadline(complete, 'burst recovery did not complete');
        assert.equal(received, 8);
        const closed = once(socket, 'close', { signal: AbortSignal.timeout(10_000) });
        socket.close();
        await closed;
      }
      if (tcp) await waitForSession(token, 'closed');
      else await peerClosed;
      recovery.push({ abort, received, settleMs: performance.now() - start });
    } finally {
      bursts.delete(token);
      socket.terminate();
    }
  }
  const upstreamFailures = [];
  if (tcp) {
    for (let sample = 0; sample < 3; sample++) {
      const url = `ws://127.0.0.1:${binding.HostPort}/ws/profile`;
      const socket = new WebSocket(url, { perMessageDeflate: false });
      await once(socket, 'open', { signal: AbortSignal.timeout(10_000) });
      const token = `disconnect:${crypto.randomUUID()}`;
      try {
        const closed = once(socket, 'close', { signal: AbortSignal.timeout(10_000) });
        socket.send(token);
        const [code] = await closed;
        assert.equal(code, 1006, 'abrupt upstream loss must not appear as a normal close');
        await waitForSession(token, 'closed');
        const fresh = new WebSocket(url, { perMessageDeflate: false });
        try {
          await once(fresh, 'open', { signal: AbortSignal.timeout(10_000) });
          const payload = crypto.randomBytes(64 * 1024);
          const message = once(fresh, 'message', { signal: AbortSignal.timeout(10_000) });
          fresh.send(payload);
          const [bytes, binary] = await message;
          assert.equal(binary, true);
          assert.deepEqual(bytes, payload);
          const freshClosed = once(fresh, 'close', { signal: AbortSignal.timeout(10_000) });
          fresh.close();
          await freshClosed;
          upstreamFailures.push({ sample, code, freshEchoBytes: bytes.length });
        } finally {
          fresh.terminate();
        }
      } finally {
        socket.terminate();
      }
    }
  }
  assert.equal(peers.size, 0, 'all fixture peers must close');
  await writeFile(
    path.join(directory, 'results.json'),
    JSON.stringify({ image, tcp, samples, recovery, upstreamFailures }, null, 2),
  );
  console.log(
    '[nginx WebSocket profile]',
    JSON.stringify({ directory, image, tcp, samples, recovery, upstreamFailures }),
  );
} finally {
  for (const peer of peers) peer.terminate();
  if (container) {
    await writeFile(path.join(directory, 'container.log'), docker('logs', container));
    const labels = JSON.parse(docker('inspect', container))[0].Config.Labels;
    assert.equal(labels['nexus.profile.identity'], identity);
    docker('rm', '-f', container);
  }
  if (upstreamContainer) {
    await writeFile(path.join(directory, 'upstream.log'), docker('logs', upstreamContainer));
    assert.equal(JSON.parse(docker('inspect', upstreamContainer))[0].Config.Labels['nexus.profile.identity'], identity);
    docker('rm', '-f', upstreamContainer);
  }
  if (network) {
    assert.equal(JSON.parse(docker('network', 'inspect', network))[0].Labels['nexus.profile.identity'], identity);
    docker('network', 'rm', network);
  }
  await Promise.all([unixServer, directServer].map((server) => new Promise((resolve) => server.close(resolve))));
}

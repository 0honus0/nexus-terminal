import http from 'node:http';
import { createRequire } from 'node:module';

const requireFromBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const { WebSocketServer, WebSocket } = requireFromBackend('ws');

const host = '127.0.0.1';
const port = 29090;
const expectedSecret = 'e2e-remote-gateway-shared-secret-do-not-use-outside-tests';
const guacamoleClients = new Set();
let remoteClipboardStreamId = 100;

const guacInstruction = (...elements) =>
  `${elements.map((value) => `${String(value).length}.${String(value)}`).join(',')};`;

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const sendJson = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const invalidRemoteDesktopRequest = (payload) => {
  if (!payload || typeof payload !== 'object') return 'request body must be an object';
  if (payload.protocol !== 'rdp' && payload.protocol !== 'vnc') return 'protocol must be rdp or vnc';
  const config = payload.connectionConfig;
  if (!config || typeof config !== 'object') return 'connectionConfig must be an object';
  if (typeof config.hostname !== 'string' || !config.hostname) return 'hostname is required';
  if (typeof config.port !== 'string' || !/^\d+$/.test(config.port)) return 'port must be a numeric string';
  if (typeof config.password !== 'string' || !config.password) return 'password is required';
  for (const key of ['width', 'height']) {
    if (typeof config[key] !== 'string' || !/^\d+$/.test(config[key])) return `${key} must be a numeric string`;
  }
  if (payload.protocol === 'rdp') {
    if (typeof config.dpi !== 'string' || !/^\d+$/.test(config.dpi)) return 'dpi must be a numeric string';
    if (config.resizeMethod !== 'display-update') return 'RDP resizeMethod must be display-update';
    if (config.security !== 'any') return 'RDP security must be any';
    if (config.ignoreCert !== true) return 'RDP ignoreCert must be true';
    if (
      config.remoteApp !== undefined &&
      (typeof config.remoteApp !== 'string' || !config.remoteApp.startsWith('||'))
    ) {
      return 'RDP remoteApp must use the Guacamole || alias form';
    }
    if (config.remoteAppDir !== undefined && typeof config.remoteAppDir !== 'string')
      return 'remoteAppDir must be a string';
    if (config.remoteAppArgs !== undefined && typeof config.remoteAppArgs !== 'string')
      return 'remoteAppArgs must be a string';
  }
  return null;
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/e2e/guacamole/clipboard') {
      const payload = await readJson(req);
      const text = typeof payload.text === 'string' ? payload.text : '';
      const streamId = remoteClipboardStreamId++;
      const data = Buffer.from(text, 'utf8').toString('base64');
      for (const socket of guacamoleClients) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        socket.send(guacInstruction('clipboard', streamId, 'text/plain'));
        socket.send(guacInstruction('blob', streamId, data));
        socket.send(guacInstruction('end', streamId));
      }
      sendJson(res, 200, { ok: true, streamId, clientCount: guacamoleClients.size });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/remote-desktop/token') {
      if (req.headers['x-nexus-gateway-secret'] !== expectedSecret) {
        sendJson(res, 401, { error: 'invalid test gateway secret' });
        return;
      }
      const payload = await readJson(req);
      const invalid = invalidRemoteDesktopRequest(payload);
      if (invalid) {
        sendJson(res, 422, { error: invalid });
        return;
      }
      sendJson(res, 200, { token: 'e2e-remote-desktop-token' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const guacamoleServer = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);
  if (requestUrl.searchParams.get('token') !== 'e2e-remote-desktop-token') {
    socket.destroy();
    return;
  }
  guacamoleServer.handleUpgrade(req, socket, head, (client) => guacamoleServer.emit('connection', client, req));
});

guacamoleServer.on('connection', (socket) => {
  guacamoleClients.add(socket);

  // The first protocol update moves guacamole-common-js from WAITING to CONNECTED.
  socket.send(guacInstruction('sync', Date.now()));

  socket.on('message', (payload, isBinary) => {
    if (isBinary) return;
    const message = payload.toString();

    // WebSocketTunnel uses the empty internal opcode for connection-stability
    // pings. Echoing these keeps the browser tunnel healthy during UI tests.
    if (message.includes('4.ping')) socket.send(message);
  });
  socket.on('close', () => guacamoleClients.delete(socket));
  socket.on('error', () => guacamoleClients.delete(socket));
});

server.listen(port, host, () => {
  console.log(`[E2E remote gateway] listening on http://${host}:${port}`);
});

const shutdown = () => {
  for (const socket of guacamoleClients) socket.close();
  guacamoleServer.close();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

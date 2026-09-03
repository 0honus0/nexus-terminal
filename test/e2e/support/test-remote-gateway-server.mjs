import http from 'node:http';

const host = '127.0.0.1';
const port = 29090;
const expectedSecret = 'e2e-remote-gateway-shared-secret-do-not-use-outside-tests';

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

server.listen(port, host, () => {
  console.log(`[E2E remote gateway] listening on http://${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

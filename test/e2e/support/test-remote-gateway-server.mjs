import http from 'node:http';

const host = '127.0.0.1';
const port = 29090;
const expectedSecret = 'e2e-remote-gateway-shared-secret-do-not-use-outside-tests';
let latestRequest = null;

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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/control/reset') {
      latestRequest = null;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && req.url === '/control/latest') {
      sendJson(res, 200, { latestRequest });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/remote-desktop/token') {
      if (req.headers['x-nexus-gateway-secret'] !== expectedSecret) {
        sendJson(res, 401, { error: 'invalid test gateway secret' });
        return;
      }
      latestRequest = await readJson(req);
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

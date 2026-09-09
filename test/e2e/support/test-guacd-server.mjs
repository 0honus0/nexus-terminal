import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const guacamoleEntry = requireFromBackend.resolve('guacamole-lite');
const MockGuacdServer = requireFromBackend(path.join(path.dirname(guacamoleEntry), 'test/helpers/MockGuacdServer.js'));

const host = '127.0.0.1';
const guacdPort = 24822;
const controlPort = 29090;
const guacd = new MockGuacdServer({ port: guacdPort, verbose: false });
let remoteClipboardStreamId = 100;

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

const controlServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, guacdPort });
      return;
    }
    if (req.method === 'POST' && req.url === '/e2e/guacamole/clipboard') {
      const payload = await readJson(req);
      const text = typeof payload.text === 'string' ? payload.text : '';
      const streamId = remoteClipboardStreamId++;
      const data = Buffer.from(text, 'utf8').toString('base64');
      let clientCount = 0;
      for (const client of guacd.allClients) {
        clientCount += 1;
        client.send('clipboard', streamId, 'text/plain');
        client.send('blob', streamId, data);
        client.send('end', streamId);
      }
      sendJson(res, 200, { ok: true, streamId, clientCount });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

await guacd.start();
controlServer.listen(controlPort, host, () => {
  console.log(`[E2E guacd] guacd=${host}:${guacdPort}, control=http://${host}:${controlPort}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolve) => controlServer.close(resolve));
  await guacd.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

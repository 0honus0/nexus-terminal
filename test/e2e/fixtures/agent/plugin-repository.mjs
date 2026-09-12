import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const current = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(current, '../../../..');
const host = '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_PLUGIN_REPOSITORY_PORT ?? '29092');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('NEXUS_E2E_PLUGIN_REPOSITORY_PORT_INVALID');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-plugin-repo-'));
const keyPath = path.join(temp, 'publisher.pem');
const packagePath = path.join(temp, 'nexus.developer-1.0.0.tar');
const { privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const metadata = JSON.parse(
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, 'scripts/agent-plugins/build-package.mjs'),
      path.join(repoRoot, 'agent-plugins/presets/nexus.developer'),
      packagePath,
      keyPath,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  ),
);
const packageBytes = fs.readFileSync(packagePath);
const catalog = {
  schemaVersion: 1,
  publishers: [
    {
      keyId: metadata.publisherKeyId,
      label: 'Nexus E2E Preset Publisher',
      publicKeyPem: metadata.publicKeyPem,
    },
  ],
  packages: [
    {
      appId: metadata.appId,
      version: metadata.version,
      displayName: metadata.displayName,
      description: 'Signed E2E distribution of the first-party Developer Agent preset.',
      packageUrl: `http://${host}:${port}/packages/nexus.developer-1.0.0.tar`,
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes,
      publisherKeyId: metadata.publisherKeyId,
    },
  ],
};
const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === 'GET' && request.url === '/catalog.json') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': String(catalogBytes.byteLength),
      'Cache-Control': 'no-store',
    });
    response.end(catalogBytes);
    return;
  }
  if (request.method === 'GET' && request.url === '/packages/nexus.developer-1.0.0.tar') {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(packageBytes.byteLength),
      'Cache-Control': 'no-store',
    });
    response.end(packageBytes);
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, host, () => {
  console.log(`[E2E Agent Plugin Repository] listening on http://${host}:${port}`);
});

const shutdown = () =>
  server.close(() => {
    fs.rmSync(temp, { recursive: true, force: true });
    process.exit(0);
  });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

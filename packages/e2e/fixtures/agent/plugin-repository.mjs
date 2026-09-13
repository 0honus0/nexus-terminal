import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const current = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.NEXUS_E2E_PLUGIN_REPOSITORY_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.NEXUS_E2E_PLUGIN_REPOSITORY_PORT ?? '29092');
const publicBaseUrl = (
  process.env.NEXUS_E2E_PLUGIN_REPOSITORY_PUBLIC_BASE_URL?.trim() || `http://${host}:${port}`
).replace(/\/$/, '');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('NEXUS_E2E_PLUGIN_REPOSITORY_PORT_INVALID');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-plugin-repo-'));
const keyPath = path.join(temp, 'publisher.pem');
const configuredSigningKey = process.env.NEXUS_E2E_PLUGIN_SIGNING_KEY_PEM?.trim();
if (configuredSigningKey) fs.writeFileSync(keyPath, `${configuredSigningKey}\n`);
else {
  const { privateKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
}

const buildPackage = (appId, version) => {
  const packageName = `${appId}-${version}.tar`;
  const packagePath = path.join(temp, packageName);
  const metadata = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(current, 'build-plugin-package.mjs'),
        path.join(current, `plugin-source/${appId}`),
        packagePath,
        keyPath,
      ],
      { cwd: current, encoding: 'utf8' },
    ),
  );
  return { metadata, packageName, bytes: fs.readFileSync(packagePath) };
};

const packages = [
  {
    ...buildPackage('nexus.agent', '1.0.0'),
    description: 'Signed E2E Nexus Agent fixture with Operations and Developer Skills.',
  },
  {
    ...buildPackage('nexus.fullstack', '1.0.0'),
    description: 'Signed E2E first-party frontend/backend/runner target fixture.',
  },
  { ...buildPackage('nexus.custom-surface', '1.0.0'), description: 'E2E-only focused Custom App Surface SDK fixture.' },
];
const publisher = packages[0].metadata;

const unsafePackageName = 'nexus.unsafe-1.0.0.tar';
const unsafePackagePath = path.join(temp, unsafePackageName);
const unsafeRoot = path.join(temp, 'unsafe-package');
fs.mkdirSync(unsafeRoot, { recursive: true });
fs.symlinkSync('/etc/passwd', path.join(unsafeRoot, 'escape'));
execFileSync('tar', ['--format=ustar', '-cf', unsafePackagePath, '-C', unsafeRoot, '.']);
const unsafePackageBytes = fs.readFileSync(unsafePackagePath);
const unsafePackageHash = createHash('sha256').update(unsafePackageBytes).digest('hex');

const catalog = {
  schemaVersion: 1,
  publishers: [
    {
      keyId: publisher.publisherKeyId,
      label: 'Nexus E2E Preset Publisher',
      publicKeyPem: publisher.publicKeyPem,
    },
  ],
  packages: [
    ...packages.map(({ metadata, packageName, description }) => ({
      appId: metadata.appId,
      version: metadata.version,
      displayName: metadata.displayName,
      description,
      packageUrl: `${publicBaseUrl}/packages/${packageName}`,
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes,
      publisherKeyId: metadata.publisherKeyId,
    })),
    {
      appId: 'nexus.unsafe',
      version: '1.0.0',
      displayName: 'Unsafe Archive Fixture',
      description: 'E2E-only package containing a symbolic link and no trusted payload.',
      packageUrl: `${publicBaseUrl}/packages/${unsafePackageName}`,
      sha256: unsafePackageHash,
      sizeBytes: unsafePackageBytes.byteLength,
      publisherKeyId: publisher.publisherKeyId,
    },
  ],
};
const catalogBytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
const packageByUrl = new Map([
  ...packages.map((candidate) => [`/packages/${candidate.packageName}`, candidate.bytes]),
  [`/packages/${unsafePackageName}`, unsafePackageBytes],
]);

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
  const packageBytes = request.method === 'GET' ? packageByUrl.get(request.url ?? '') : undefined;
  if (packageBytes) {
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

#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [sourceArg, outputArg, keyArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || !keyArg) {
  console.error(
    'Usage: node packages/e2e/fixtures/agent/build-plugin-package.mjs <source-dir> <output.tar> <ed25519-private-key.pem>',
  );
  process.exit(2);
}
const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
const privateKeyPath = path.resolve(keyArg);
const manifestSource = path.join(source, 'manifest.json');
if (!fs.statSync(source).isDirectory() || !fs.statSync(manifestSource).isFile())
  throw new Error('PLUGIN_SOURCE_INVALID');
const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath));
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('PLUGIN_SIGNING_KEY_INVALID');
const publicKey = createPublicKey(privateKey);
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const publisherKeyId = `ed25519:${createHash('sha256').update(publicDer).digest('hex')}`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-plugin-'));
try {
  const root = path.join(temp, 'package');
  fs.cpSync(source, root, { recursive: true, dereference: false });
  const visit = (directory, prefix = '') => {
    const result = [];
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('PLUGIN_SOURCE_SYMLINK_DENIED');
      if (entry.isDirectory()) result.push(...visit(target, relative));
      else if (entry.isFile() && !['manifest.json', 'files.json', 'signature.ed25519'].includes(relative)) {
        const bytes = fs.readFileSync(target);
        result.push({
          path: relative,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.byteLength,
        });
      } else if (!entry.isFile()) throw new Error('PLUGIN_SOURCE_ENTRY_INVALID');
    }
    return result;
  };
  const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
  JSON.parse(manifestBytes.toString('utf8'));
  const fileListBytes = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, publisherKeyId, files: visit(root) }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'files.json'), fileListBytes, { mode: 0o644 });
  const signed = Buffer.concat([
    Buffer.from('NEXUS_AGENT_PLUGIN_V1\0', 'utf8'),
    manifestBytes,
    Buffer.from([0]),
    fileListBytes,
  ]);
  fs.writeFileSync(path.join(root, 'signature.ed25519'), sign(null, signed, privateKey), { mode: 0o644 });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--format=ustar',
      '-cf',
      output,
      '-C',
      root,
      '.',
    ],
    { stdio: 'inherit' },
  );
  const packageBytes = fs.readFileSync(output);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  process.stdout.write(
    `${JSON.stringify(
      {
        appId: manifest.id,
        version: manifest.version,
        displayName: manifest.displayName,
        publisherKeyId,
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        sha256: createHash('sha256').update(packageBytes).digest('hex'),
        sizeBytes: packageBytes.byteLength,
        output,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

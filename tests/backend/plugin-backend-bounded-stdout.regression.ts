import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoundedProtocolLineBuffer } from '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter';

const main = (): void => {
  const buffer = new BoundedProtocolLineBuffer(8);
  assert.deepEqual(buffer.push(Buffer.from('abc')), []);
  assert.equal(buffer.bufferedBytes(), 3);
  assert.deepEqual(
    buffer.push(Buffer.from('def\nxy\r\n')).map((line) => line.toString('utf8')),
    ['abcdef', 'xy'],
  );
  assert.equal(buffer.bufferedBytes(), 0);

  const oversized = new BoundedProtocolLineBuffer(8);
  assert.deepEqual(oversized.push(Buffer.from('12345678')), []);
  assert.equal(oversized.bufferedBytes(), 8);
  assert.throws(() => oversized.push(Buffer.from('9-without-newline')), /PLUGIN_BACKEND_RESPONSE_TOO_LARGE/);
  assert.equal(oversized.bufferedBytes(), 8, 'overflowing chunk must not be appended to the retained frame buffer');

  const directOversized = new BoundedProtocolLineBuffer(8);
  assert.throws(() => directOversized.push(Buffer.alloc(1024, 0x61)), /PLUGIN_BACKEND_RESPONSE_TOO_LARGE/);
  assert.equal(directOversized.bufferedBytes(), 0, 'huge no-newline chunk must be rejected before buffering');

  const source = fs.readFileSync(
    new URL(
      '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.equal(source.includes("from 'node:readline'"), false, 'untrusted stdout must not use unbounded readline');
  assert(source.includes("child.stdout.on('data'"));
  assert(source.includes("child.kill('SIGKILL')"));

  process.stdout.write('plugin backend bounded stdout regression: PASS\n');
};

main();

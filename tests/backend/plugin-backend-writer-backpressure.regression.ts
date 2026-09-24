import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Writable } from 'node:stream';
import { BoundedProtocolWriter } from '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter';

const main = async (): Promise<void> => {
  const callbacks: Array<() => void> = [];
  const sink = new Writable({
    highWaterMark: 8,
    write(_chunk, _encoding, callback) {
      callbacks.push(() => callback());
    },
  });
  const writer = new BoundedProtocolWriter(sink, 24, 2);

  const first = writer.write('1234567890');
  const second = writer.write('abcdefghij');
  await assert.rejects(() => writer.write('klmnopqrst'), /PLUGIN_BACKEND_BACKPRESSURE_LIMIT/);
  assert.deepEqual(writer.queued(), { bytes: 22, frames: 2 });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(callbacks.length, 1, 'backpressured writer must serialize frames instead of flooding Writable');
  callbacks.shift()!();
  await first;

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(callbacks.length, 1);
  callbacks.shift()!();
  await second;
  assert.deepEqual(writer.queued(), { bytes: 0, frames: 0 });

  const source = fs.readFileSync(
    new URL(
      '../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.equal(
    (source.match(/child\.stdin\.write/g) ?? []).length,
    0,
    'all Host→child frames must use the bounded writer',
  );
  assert(source.includes('MAX_PLUGIN_HOST_OPERATIONS = 32'));
  assert(source.includes('this.trackHostOperation(() => this.handleStorage('));
  assert(source.includes('this.trackHostOperation(() => this.handleIntent('));

  process.stdout.write('Plugin Backend writer backpressure regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { StreamUploadOperationService } from '../../packages/backend/src/platform/operations/upload/stream-upload-operation.service';
import { SshRemoteFileSystemAdapter } from '../../packages/backend/src/infrastructure/ssh/filesystem/ssh-remote-file-system.adapter';

test('upload queues bounded batches rather than awaiting every remote acknowledgement', async () => {
  let batches = 0;
  let written = 0;
  const stream = new Writable({
    highWaterMark: 4 * 1024 * 1024,
    write(chunk, _encoding, callback) {
      setTimeout(() => {
        written += chunk.length;
        callback();
      }, 10);
    },
    writev(chunks, callback) {
      batches++;
      setTimeout(() => {
        written += chunks.reduce((sum, chunk) => sum + chunk.chunk.length, 0);
        callback();
      }, 10);
    },
  });
  const size = 8 * 512 * 1024;
  let replaced = false;
  const filesystem = {
    ensureDirectory: async () => {},
    exists: async () => false,
    removeFile: async () => {},
    openWrite: async () => stream,
    metadata: async () => ({ size: written }),
    replaceFile: async () => {
      assert.equal(written, size);
      replaced = true;
    },
  };
  const service = new StreamUploadOperationService({
    require: () => ({ fileSystem: async () => filesystem }),
  } as never);
  const events: string[] = [];
  await service.start(
    { ownerId: 'owner', sessionId: 'session', uploadId: 'upload', destinationPath: '/file', size },
    (e) => events.push(e.type),
  );
  await Promise.all(
    Array.from({ length: 8 }, (_, chunkIndex) =>
      service.append({
        ownerId: 'owner',
        uploadId: 'upload',
        chunkIndex,
        data: Buffer.alloc(512 * 1024),
        isLast: chunkIndex === 7,
      }),
    ),
  );
  assert.ok(batches > 0, 'SFTP writev must be able to batch queued chunks');
  assert.ok(replaced);
  assert.equal(events.at(-1), 'completed');
});

test('download prefetch preserves byte order, range and short reads with bounded concurrency', async () => {
  const source = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  let active = 0,
    peak = 0,
    closes = 0;
  const channel = {
    stat(_path: string, cb: Function) {
      cb(null, { size: source.length, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
    },
    open(_path: string, _flags: string, cb: Function) {
      cb(null, Buffer.from('handle'));
    },
    read(_handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, cb: Function) {
      peak = Math.max(peak, ++active);
      setTimeout(() => {
        const count = Math.min(length, 32768, source.length - position);
        source.copy(buffer, offset, position, position + count);
        active--;
        cb(null, count);
      }, position % 3);
    },
    close(_handle: Buffer, cb: Function) {
      closes++;
      cb(null);
    },
  };
  const adapter = new SshRemoteFileSystemAdapter(async () => channel as never);
  const stream = await adapter.openRead('/file', { start: 123, end: 1500123 });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), source.subarray(123, 1500124));
  assert.ok(peak > 1);
  assert.ok(peak <= 16);
  assert.equal(closes, 1);
});

test('cancelling a backpressured upload releases the append queue without publishing a file', async () => {
  const stream = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) {} });
  let replaced = false;
  const filesystem = {
    ensureDirectory: async () => {},
    exists: async () => false,
    removeFile: async () => {},
    openWrite: async () => stream,
    replaceFile: async () => {
      replaced = true;
    },
  };
  const service = new StreamUploadOperationService({
    require: () => ({ fileSystem: async () => filesystem }),
  } as never);
  const events: string[] = [];
  await service.start(
    { ownerId: 'owner', sessionId: 'session', uploadId: 'cancel', destinationPath: '/file', size: 1024 },
    (e) => events.push(e.type),
  );
  const append = service.append({
    ownerId: 'owner',
    uploadId: 'cancel',
    chunkIndex: 0,
    data: Buffer.alloc(512),
    isLast: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await service.cancel('owner', 'cancel');
  await append;
  assert.equal(replaced, false);
  assert.equal(events.at(-1), 'cancelled');
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { TemporaryLogStorageService } = require(path.join(root, 'packages/backend/dist/ssh-suspend/temporary-log-storage.service.js'));
const { SshSuspendService } = require(path.join(root, 'packages/backend/dist/ssh-suspend/ssh-suspend.service.js'));

class FakeChannel extends EventEmitter {
  readable = true;
  writable = true;
  paused = false;
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  close() { this.readable = false; this.writable = false; this.emit('close'); }
  end() { this.close(); }
}

class FakeClient extends EventEmitter {
  end() { this.emit('end'); }
}

const collect = async stream => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const storage = new TemporaryLogStorageService();
const service = new SshSuspendService(storage);
const channel = new FakeChannel();
const client = new FakeClient();
const logIdentifier = `verify_${randomUUID().replaceAll('-', '')}`;
const originalSessionId = randomUUID();
let suspendSessionId;

try {
  suspendSessionId = await service.takeOverMarkedSession({
    userId: 1,
    originalSessionId,
    sshClient: client,
    channel,
    connectionName: 'verification',
    connectionId: '1',
    logIdentifier,
  });
  assert.ok(suspendSessionId);
  const suspendedList = await service.listSuspendedSessions(1);
  assert.equal(suspendedList.length, 1);
  assert.equal(suspendedList[0]?.originalSessionId, originalSessionId, 'Suspended list must preserve the original frontend session ID for foreground recovery');

  const firstBatch = Array.from({ length: 128 }, (_, index) => `first-${index.toString().padStart(3, '0')}\n`);
  for (const chunk of firstBatch) channel.emit('data', Buffer.from(chunk));

  const firstPrepare = await service.prepareResumeSession(1, suspendSessionId);
  assert.ok(firstPrepare, 'First resume preparation should succeed');
  assert.equal(await collect(await storage.createLogReadStream(logIdentifier)), firstBatch.join(''));

  assert.equal(await service.rollbackResumeSession(1, suspendSessionId), true);
  assert.equal(channel.paused, false, 'Rollback should resume the SSH channel');
  channel.emit('data', Buffer.from('after-rollback\n'));

  const secondPrepare = await service.prepareResumeSession(1, suspendSessionId);
  assert.ok(secondPrepare, 'Resume should be retryable after rollback');
  assert.equal(
    await collect(await storage.createLogReadStream(logIdentifier)),
    `${firstBatch.join('')}after-rollback\n`,
  );
  assert.equal(await service.commitResumeSession(1, suspendSessionId), true);
  assert.equal((await service.listSuspendedSessions(1)).length, 0);
  assert.equal(await collect(await storage.createLogReadStream(logIdentifier)), '');

  console.log('SSH suspend log ordering and resume transaction check passed.');
} finally {
  await storage.deleteLog(logIdentifier).catch(() => undefined);
}

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

const expected = JSON.parse(await readFile(new URL('./data/catalog.json', import.meta.url), 'utf8'));
const child = fork(new URL('./server.mjs', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const exit = once(child, 'exit');
const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
try {
  const [{ port }] = await Promise.race([
    once(child, 'message'),
    exit.then(() => {
      throw Error('SERVER_EXIT_BEFORE_READY');
    }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  console.log(JSON.stringify({ serverPid: child.pid, port }));
  const health = await fetch(origin + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  for (const requestId of ['b01-request-one', 'b01-request-two']) {
    const response = await fetch(origin + '/catalog', { headers: { 'X-Request-Id': requestId } });
    const body = await response.json();
    console.log(JSON.stringify({ requestId, status: response.status, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(body, expected);
  }
  assert.equal((await fetch(origin + '/missing')).status, 404);
  console.log('HTTP health/catalog/404 verified');
} finally {
  child.kill('SIGTERM');
  await exit;
  clearTimeout(deadline);
}

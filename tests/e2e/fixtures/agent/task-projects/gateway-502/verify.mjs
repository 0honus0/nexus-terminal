import assert from 'node:assert/strict';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

const child = fork(new URL('./server.mjs', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
const exit = once(child, 'exit');
const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
try {
  const [{ port, socket }] = await Promise.race([
    once(child, 'message'),
    exit.then(() => {
      throw Error('SERVER_EXIT_BEFORE_READY');
    }),
  ]);
  console.log(JSON.stringify({ serverPid: child.pid, port, socket }));
  const direct = await new Promise((resolve, reject) => {
    const request = http.get({ socketPath: socket, path: '/health' }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
  });
  console.log(JSON.stringify({ directUpstream: direct }));
  assert.deepEqual(direct, { status: 200, body: { status: 'ok', service: 'upstream' } });
  const expected = JSON.parse(await readFile(new URL('./data/catalog.json', import.meta.url), 'utf8'));
  for (const [route, body] of [
    ['/health', direct.body],
    ['/catalog', expected],
  ]) {
    const requestId = route === '/health' ? 'b02-health' : 'b02-catalog';
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { 'X-Request-Id': requestId } });
    const actual = await response.json();
    console.log(JSON.stringify({ requestId, status: response.status, body: actual }));
    assert.equal(response.status, 200);
    assert.deepEqual(actual, body);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
  console.log('Direct upstream and gateway health/catalog/404 verified');
} finally {
  child.kill('SIGTERM');
  await exit;
  clearTimeout(deadline);
}

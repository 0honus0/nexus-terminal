import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const parent = path.join(repo, 'tests/e2e/.tmp');
fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, 'workspace-runner-'));
// Run the production controller; only model responses are scripted elsewhere.
const require = createRequire(path.join(repo, 'packages/backend/package.json'));
const child = spawn(
  process.execPath,
  ['--import', require.resolve('tsx'), path.join(repo, 'packages/agent-runner/src/index.ts')],
  {
    cwd: path.join(repo, 'packages/backend'),
    env: {
      ...process.env,
      PORT: process.env.NEXUS_E2E_AGENT_RUNNER_PORT ?? '29095',
      NEXUS_AGENT_RUNNER_HOST: '127.0.0.1',
      NEXUS_AGENT_RUNNER_ROOT: root,
      NEXUS_AGENT_CATALOG: path.join(repo, 'scripts/docker/agent-runner/catalog/catalog.json'),
      NEXUS_AGENT_RUNNER_TOKEN: 'e2e-isolated-runner-token-not-for-production-00000000',
    },
    stdio: 'inherit',
  },
);
let stopping = false;
const health = http.createServer(async (_request, response) => {
  try {
    const ready = await fetch(`http://127.0.0.1:${process.env.NEXUS_E2E_AGENT_RUNNER_PORT ?? '29095'}/v1/catalog`, {
      headers: {
        Authorization: 'Bearer e2e-isolated-runner-token-not-for-production-00000000',
        'X-Nexus-Agent-Protocol': '2026-10-08',
      },
      signal: AbortSignal.timeout(1000),
    });
    response.writeHead(ready.ok ? 200 : 503).end();
  } catch {
    response.writeHead(503).end();
  }
});
health.listen(Number(process.env.NEXUS_E2E_AGENT_RUNNER_PORT ?? '29095') + 1, '127.0.0.1');
const stop = () => {
  if (stopping) return;
  stopping = true;
  health.close();
  child.kill('SIGTERM');
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  health.close();
  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = stopping ? 0 : (code ?? 1);
});

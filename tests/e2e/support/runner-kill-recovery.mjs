import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
fs.mkdirSync('/tmp/opencode', { recursive: true });
const root = fs.mkdtempSync('/tmp/opencode/nexus-runner-kill-');
const load = (name) => import(pathToFileURL(path.join(repo, 'packages/agent-runner/dist/controller', `${name}.js`)));
const { RunnerJournal } = await load('journal');
const { WorkspaceRuntimeEngine } = await load('workspace-runtime-engine');
const { ToolchainStore } = await load('toolchain-store');
const workspaceId = 'kill-recovery-workspace';
const identity = { workspaceId, generation: 1, toolchain: [], runtimeDigest: 'kill-recovery-fixture' };
// Seed only the isolated runtime fixture; Job execution and recovery use the real server HTTP boundary.
const engine = new WorkspaceRuntimeEngine(path.join(root, 'runtime'), new ToolchainStore(path.join(root, 'packs')));
await engine.create(identity);
await engine.start(workspaceId, 1);
fs.mkdirSync(path.join(root, 'state'), { recursive: true });
const journal = new RunnerJournal(path.join(root, 'state/journal.sqlite'));
journal.saveWorkspace({
  ...identity,
  status: 'running',
  retained: false,
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
});
journal.close();
const catalog = path.join(root, 'catalog.json');
fs.writeFileSync(
  catalog,
  JSON.stringify({
    schemaVersion: 1,
    revision: 'fixture',
    runtimeDigest: identity.runtimeDigest,
    recipes: [],
    packs: [],
  }),
);
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const token = 'isolated-kill-recovery-token-00000000000000';
const headers = {
  authorization: `Bearer ${token}`,
  'x-nexus-agent-protocol': '2026-09-13',
  'content-type': 'application/json',
};
let child;
const poll = async (read, predicate) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Runner recovery condition not observed');
};
const api = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3000),
  });
  const value = await response.json();
  assert.equal(response.ok, true, JSON.stringify(value));
  return value;
};
const start = async () => {
  const log = fs.openSync(path.join(root, 'runner.log'), 'a');
  child = spawn(process.execPath, [path.join(repo, 'packages/agent-runner/dist/index.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      NEXUS_AGENT_RUNNER_HOST: '127.0.0.1',
      NEXUS_AGENT_RUNNER_ROOT: root,
      NEXUS_AGENT_CATALOG: catalog,
      NEXUS_AGENT_RUNNER_TOKEN: token,
    },
    stdio: ['ignore', log, log],
  });
  fs.closeSync(log);
  await poll(
    () => api('/v1/catalog').catch(() => null),
    (value) => value !== null,
  );
};
const stop = async (signal) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  const [code, actualSignal] = await exited;
  if (signal === 'SIGKILL') {
    assert.equal(code, null);
    assert.equal(actualSignal, 'SIGKILL');
  }
};
const marker = path.join(root, 'executions.txt');
const pidFile = path.join(root, 'job.pid');
const descendantPidFile = path.join(root, 'descendants.json');
const grandchildSource = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(descendantPidFile)}, JSON.stringify({ child: process.ppid, grandchild: process.pid })); setInterval(() => {}, 1000);`;
const childSource = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
const processState = (pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat
      .slice(stat.lastIndexOf(') ') + 2)
      .trim()
      .split(/\s+/);
    return { state: fields[0], group: Number(fields[2]), startTime: fields[19] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
};
const job = {
  jobId: 'kill-recovery-job',
  generation: 1,
  deadlineAt: Math.floor(Date.now() / 1000) + 240,
  argv: [
    process.execPath,
    '-e',
    `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); fs.appendFileSync(${JSON.stringify(marker)}, 'once\\n'); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`,
  ],
  cwd: '/workspace/work',
  maxBytes: 1024,
  timeoutMs: 120000,
};
try {
  await start();
  assert.equal((await api(`/v1/workspaces/${workspaceId}/jobs`, job)).status, 'running');
  await poll(
    () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''),
    (value) => value === 'once\n',
  );
  const oldPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isSafeInteger(oldPid) && oldPid > 0);
  process.kill(oldPid, 0);
  const descendants = await poll(
    () => (fs.existsSync(descendantPidFile) ? JSON.parse(fs.readFileSync(descendantPidFile, 'utf8')) : null),
    (value) => value !== null,
  );
  const descendantIdentities = [descendants.child, descendants.grandchild].map((pid) => {
    assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== oldPid);
    process.kill(pid, 0);
    const identity = processState(pid);
    assert.ok(identity && identity.state !== 'Z' && identity.state !== 'X');
    assert.equal(identity.group, oldPid, 'Descendants must inherit the managed Job process group');
    return { pid, ...identity };
  });
  assert.notEqual(descendants.child, descendants.grandchild);
  assert.equal((await api(`/v1/jobs/${job.jobId}`)).status, 'running');
  await stop('SIGKILL');
  for (const identity of descendantIdentities) {
    const current = processState(identity.pid);
    assert.ok(current && current.startTime === identity.startTime && !['Z', 'X'].includes(current.state));
  }
  await start();
  await poll(() => {
    try {
      process.kill(oldPid, 0);
      return false;
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      return true;
    }
  }, Boolean);
  for (const identity of descendantIdentities) {
    await poll(() => {
      const current = processState(identity.pid);
      // A killed orphan may remain a zombie until the host init reaps it.
      // PID disappearance, reuse or a dead state proves this exact process no longer executes.
      return !current || current.startTime !== identity.startTime || ['Z', 'X'].includes(current.state);
    }, Boolean);
  }
  const recovered = await api(`/v1/jobs/${job.jobId}`);
  assert.equal(recovered.status, 'unknown');
  assert.equal((await api(`/v1/workspaces/${workspaceId}/jobs`, job)).status, 'unknown');
  const next = {
    ...job,
    jobId: 'kill-recovery-next',
    argv: [process.execPath, '-e', "process.stdout.write('recovered')"],
  };
  await api(`/v1/workspaces/${workspaceId}/jobs`, next);
  const completed = await poll(
    () => api(`/v1/jobs/${next.jobId}`),
    (value) => value.status !== 'running' && value.status !== 'pending',
  );
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.result.stdout, 'recovered');
  await stop('SIGTERM');
  await start();
  assert.equal((await api(`/v1/jobs/${job.jobId}`)).status, 'unknown');
  assert.equal((await api(`/v1/workspaces/${workspaceId}/jobs`, job)).status, 'unknown');
  assert.equal((await api(`/v1/jobs/${next.jobId}`)).status, 'succeeded');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'once\n');
  const stubbornPidFile = path.join(root, 'cancel-descendants.json');
  const stubbornGrandchild = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(stubbornPidFile)}, JSON.stringify({ child: process.ppid, grandchild: process.pid })); setInterval(() => {}, 1000);`;
  const stubbornChild = `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(stubbornGrandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
  const cancelJob = {
    ...job,
    jobId: 'cancel-stubborn-descendants',
    argv: [
      process.execPath,
      '-e',
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(stubbornChild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`,
    ],
  };
  assert.equal((await api(`/v1/workspaces/${workspaceId}/jobs`, cancelJob)).status, 'running');
  const stubborn = await poll(
    () => (fs.existsSync(stubbornPidFile) ? JSON.parse(fs.readFileSync(stubbornPidFile, 'utf8')) : null),
    (value) => value !== null,
  );
  const stubbornIdentities = [stubborn.child, stubborn.grandchild].map((pid) => {
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const identity = processState(pid);
    assert.ok(identity && !['Z', 'X'].includes(identity.state));
    return { pid, ...identity };
  });
  assert.equal((await api(`/v1/jobs/${cancelJob.jobId}/cancel`, {})).status, 'cancelled');
  for (const identity of stubbornIdentities) {
    await poll(() => {
      const current = processState(identity.pid);
      return !current || current.startTime !== identity.startTime || ['Z', 'X'].includes(current.state);
    }, Boolean);
  }
  const afterCancel = { ...next, jobId: 'after-descendant-cancel' };
  await api(`/v1/workspaces/${workspaceId}/jobs`, afterCancel);
  const afterCancelResult = await poll(
    () => api(`/v1/jobs/${afterCancel.jobId}`),
    (value) => !['running', 'pending'].includes(value.status),
  );
  assert.equal(afterCancelResult.status, 'succeeded');
  assert.equal(afterCancelResult.result.stdout, 'recovered');
  console.log(`Runner SIGKILL recovery passed; evidence retained at ${root}`);
} finally {
  await stop('SIGTERM');
}

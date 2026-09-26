import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const engine = String(rootPackage.engines?.node ?? '');
const minimumNodeMajor = Number(/^>=\s*(\d+)/.exec(engine)?.[1] ?? 0);
const currentNodeMajor = Number(process.versions.node.split('.')[0]);
if (minimumNodeMajor && currentNodeMajor < minimumNodeMajor) {
  console.error(
    `[E2E remote] Node ${minimumNodeMajor}+ is required by package.json; current runtime is ${process.version}.`,
  );
  process.exit(2);
}

const portNames = [
  'NEXUS_E2E_BACKEND_PORT',
  'NEXUS_E2E_FRONTEND_PORT',
  'NEXUS_E2E_GUACD_PORT',
  'NEXUS_E2E_GUACD_CONTROL_PORT',
  'NEXUS_E2E_SSH_PORT',
  'NEXUS_E2E_SSH_CONTROL_PORT',
  'NEXUS_E2E_SMTP_PORT',
  'NEXUS_E2E_PLUGIN_REPOSITORY_PORT',
  'NEXUS_E2E_OPENAI_PROVIDER_PORT',
];

const assignedPorts = new Map();
const reservedPorts = new Set();
const reservations = [];

for (const name of portNames) {
  const raw = process.env[name]?.trim();
  if (!raw) continue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    console.error(`[E2E remote] ${name} must be an integer between 1 and 65535.`);
    process.exit(2);
  }
  if (reservedPorts.has(value)) {
    console.error(`[E2E remote] duplicate explicit port ${value} for ${name}.`);
    process.exit(2);
  }
  reservedPorts.add(value);
  assignedPorts.set(name, value);
}

const reservePort = async () => {
  while (true) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port || reservedPorts.has(port)) {
      await new Promise((resolve) => server.close(resolve));
      continue;
    }
    reservedPorts.add(port);
    reservations.push(server);
    return port;
  }
};

try {
  for (const name of portNames) {
    if (!assignedPorts.has(name)) {
      assignedPorts.set(name, await reservePort());
    }
  }

  const env = { ...process.env };
  for (const [name, port] of assignedPorts) {
    env[name] = String(port);
  }

  console.log('[E2E remote] isolated ports');
  for (const name of portNames) {
    console.log(`  ${name}=${assignedPorts.get(name)}`);
  }

  await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));

  const playwrightArgs = process.argv.slice(2);
  if (playwrightArgs[0] === '--') playwrightArgs.shift();

  const resolveRunner = () => {
    const isWindows = process.platform === 'win32';
    const corepackCmd = isWindows ? 'corepack.cmd' : 'corepack';
    const pnpmCmd = isWindows ? 'pnpm.cmd' : 'pnpm';

    try {
      const probe = spawnSync(corepackCmd, ['--version'], { stdio: 'ignore' });
      if (probe.status === 0) {
        return {
          command: corepackCmd,
          args: ['pnpm', '--filter', '@nexus-terminal/e2e', 'exec', 'playwright', 'test', ...playwrightArgs],
        };
      }
    } catch {}

    const knownCorepackPaths = ['/opt/webcodex-node/bin/corepack', '/usr/local/bin/corepack'];
    for (const corepackPath of knownCorepackPaths) {
      if (existsSync(corepackPath)) {
        return {
          command: corepackPath,
          args: ['pnpm', '--filter', '@nexus-terminal/e2e', 'exec', 'playwright', 'test', ...playwrightArgs],
        };
      }
    }

    return {
      command: pnpmCmd,
      args: ['--filter', '@nexus-terminal/e2e', 'exec', 'playwright', 'test', ...playwrightArgs],
    };
  };

  const { command: runnerCommand, args: runnerArgs } = resolveRunner();
  const child = spawn(runnerCommand, runnerArgs, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    console.error(`[E2E remote] failed to start Playwright: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`[E2E remote] Playwright terminated by ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
} catch (error) {
  await Promise.all(
    reservations.filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  console.error(`[E2E remote] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

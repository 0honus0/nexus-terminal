import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EnvironmentCommand, EnvironmentJobRequest, PackRef } from '../types';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const SANDBOX_ID = /^([A-Za-z0-9_.-]{1,128}):(\d+)$/;

export interface SandboxExecution {
  file: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface SandboxMetadata {
  environmentId: string;
  generation: number;
  packs: PackRef[];
  networkMode: 'none' | 'allowlist';
}

const safeSegment = (value: string): string => {
  if (!SAFE_SEGMENT.test(value)) throw new Error('ENVIRONMENT_ID_INVALID');
  return value;
};

const packTarget = (pack: PackRef): string =>
  `/opt/nexus/packs/${safeSegment(pack.familyId)}/${safeSegment(pack.versionId)}/${safeSegment(pack.contentDigest.replace(/^sha256:/, ''))}`;

export class SandboxManager {
  constructor(
    private readonly runtimeRoot: string,
    private readonly packsRoot: string,
    private readonly sandboxBinary = process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || 'bwrap',
  ) {}

  available(): boolean {
    const result = spawnSync(this.sandboxBinary, ['--version'], { stdio: 'ignore', timeout: 2_000 });
    return !result.error && result.status === 0;
  }

  create(command: EnvironmentCommand): string {
    if (command.network.mode !== 'none') throw new Error('ENVIRONMENT_NETWORK_ENFORCEMENT_UNAVAILABLE');
    const environmentId = safeSegment(command.environmentId);
    const generation = command.generation;
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
    const root = this.environmentRoot(environmentId, generation);
    if (fs.existsSync(root)) throw new Error('ENVIRONMENT_GENERATION_CONFLICT');

    for (const relative of [
      'core/workspace/work',
      'core/workspace/deps',
      'core/workspace/build',
      'core/workspace/browser',
      'core/workspace/jobs',
      'core/workspace/tmp',
      'plugins',
      '.control',
    ]) {
      fs.mkdirSync(path.join(root, relative), { recursive: true, mode: 0o700 });
    }
    const metadata: SandboxMetadata = {
      environmentId,
      generation,
      packs: command.packs.map((pack) => ({ ...pack })),
      networkMode: command.network.mode,
    };
    this.writeJson(path.join(root, '.control', 'metadata.json'), metadata);
    this.writeState(root, 'ready');
    return `${environmentId}:${generation}`;
  }

  start(sandboxId: string): void {
    const root = this.requireRoot(sandboxId);
    this.writeState(root, 'running');
  }

  stop(sandboxId: string): void {
    const root = this.requireRoot(sandboxId);
    this.writeState(root, 'stopped');
  }

  restart(sandboxId: string): void {
    const root = this.requireRoot(sandboxId);
    this.writeState(root, 'running');
  }

  remove(sandboxId: string): void {
    const root = this.rootFromId(sandboxId);
    fs.rmSync(root, { recursive: true, force: true });
  }

  status(sandboxId: string): string {
    const root = this.rootFromId(sandboxId);
    if (!fs.existsSync(root)) return 'deleted';
    try {
      const value = fs.readFileSync(path.join(root, '.control', 'state'), 'utf8').trim();
      return value || 'failed';
    } catch {
      return 'failed';
    }
  }

  prepareJob(sandboxId: string, request: EnvironmentJobRequest): SandboxExecution {
    const root = this.requireRoot(sandboxId);
    if (this.status(sandboxId) !== 'running') throw new Error('ENVIRONMENT_NOT_RUNNING');
    const metadata = this.readMetadata(root);
    if (metadata.environmentId !== request.environmentId || metadata.generation !== request.generation) {
      throw new Error('ENVIRONMENT_IDENTITY_MISMATCH');
    }
    const workspace = path.join(root, 'core', 'workspace');
    const logicalCwd = this.logicalCwd(request.cwd);
    const packBindings: string[] = [];
    const packBins: string[] = [];
    const createdDirs = new Set<string>(['/opt', '/opt/nexus', '/opt/nexus/packs']);

    for (const pack of metadata.packs) {
      const source = path.join(
        this.packsRoot,
        safeSegment(pack.familyId),
        safeSegment(pack.versionId),
        safeSegment(pack.contentDigest.replace(/^sha256:/, '')),
      );
      if (!fs.existsSync(source)) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
      const target = packTarget(pack);
      const pieces = target.split('/').filter(Boolean);
      let current = '';
      for (const piece of pieces.slice(0, -1)) {
        current += `/${piece}`;
        if (!createdDirs.has(current)) {
          packBindings.push('--dir', current);
          createdDirs.add(current);
        }
      }
      packBindings.push('--ro-bind', source, target);
      if (fs.existsSync(path.join(source, 'bin'))) packBins.push(`${target}/bin`);
    }

    const systemBindings: string[] = [];
    for (const source of ['/bin', '/usr', '/lib', '/sbin', '/etc']) {
      if (fs.existsSync(source)) systemBindings.push('--ro-bind', source, source);
    }

    return {
      file: this.sandboxBinary,
      argv: [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--unshare-net',
        ...systemBindings,
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--dir',
        '/workspace',
        '--bind',
        workspace,
        '/workspace',
        ...packBindings,
        '--chdir',
        logicalCwd,
        '--setenv',
        'HOME',
        '/workspace',
        '--setenv',
        'TMPDIR',
        '/tmp',
        '--setenv',
        'PATH',
        [...packBins, '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
        '--unsetenv',
        'NEXUS_AGENT_RUNNER_TOKEN',
        '--unsetenv',
        'NEXUS_AGENT_RUNNER_TOKEN_FILE',
        '--',
        ...request.argv,
      ],
      cwd: workspace,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG ?? 'C.UTF-8',
      },
    };
  }

  environmentRoot(environmentId: string, generation: number): string {
    return path.join(this.runtimeRoot, 'environments', safeSegment(environmentId), String(generation));
  }

  private logicalCwd(value: string): string {
    const normalized = path.posix.normalize(value.startsWith('/') ? value : `/workspace/${value}`);
    if (normalized !== '/workspace' && !normalized.startsWith('/workspace/')) throw new Error('JOB_CWD_FORBIDDEN');
    if (normalized.includes('\0')) throw new Error('JOB_CWD_FORBIDDEN');
    return normalized;
  }

  private rootFromId(sandboxId: string): string {
    const match = SANDBOX_ID.exec(sandboxId);
    if (!match) throw new Error('ENVIRONMENT_SANDBOX_ID_INVALID');
    return this.environmentRoot(match[1]!, Number(match[2]));
  }

  private requireRoot(sandboxId: string): string {
    const root = this.rootFromId(sandboxId);
    if (!fs.existsSync(root)) throw new Error('ENVIRONMENT_NOT_FOUND');
    return root;
  }

  private readMetadata(root: string): SandboxMetadata {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, '.control', 'metadata.json'), 'utf8')) as SandboxMetadata;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.packs))
      throw new Error('ENVIRONMENT_METADATA_INVALID');
    return parsed;
  }

  private writeState(root: string, state: 'ready' | 'running' | 'stopped'): void {
    fs.writeFileSync(path.join(root, '.control', 'state'), `${state}\n`, { mode: 0o600 });
  }

  private writeJson(file: string, value: unknown): void {
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  }
}

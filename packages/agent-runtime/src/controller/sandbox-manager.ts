import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EnvironmentCommand, EnvironmentJobRequest, PackRef } from '../types';
import { sandboxSystemRuntimeArguments } from './sandbox-system-runtime';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const SANDBOX_ID = /^([A-Za-z0-9_.-]{1,128}):(\d+)$/;

export interface SandboxExecution {
  file: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface SandboxAvailability {
  available: boolean;
  reason: string | null;
}

interface SandboxMetadata {
  environmentId: string;
  generation: number;
  packs: PackRef[];
  networkMode: 'none' | 'allowlist';
  runtimeDigest?: string;
  toolchainFingerprint?: string;
}

const toolchainFingerprint = (runtimeDigest: string, packs: readonly PackRef[]): string =>
  createHash('sha256')
    .update(runtimeDigest)
    .update('\u0000')
    .update(
      JSON.stringify(
        [...packs]
          .map((pack) => ({
            familyId: pack.familyId,
            versionId: pack.versionId,
            contentDigest: pack.contentDigest,
          }))
          .sort((a, b) =>
            `${a.familyId}\u0000${a.versionId}\u0000${a.contentDigest}`.localeCompare(
              `${b.familyId}\u0000${b.versionId}\u0000${b.contentDigest}`,
            ),
          ),
      ),
    )
    .digest('hex');

const safeSegment = (value: string): string => {
  if (!SAFE_SEGMENT.test(value)) throw new Error('ENVIRONMENT_ID_INVALID');
  return value;
};

const packTarget = (pack: PackRef): string =>
  `/opt/nexus/packs/${safeSegment(pack.familyId)}/${safeSegment(pack.versionId)}/${safeSegment(pack.contentDigest.replace(/^sha256:/, ''))}`;

export class SandboxManager {
  private lastProbeDiagnostic: string | null = null;

  constructor(
    private readonly runtimeRoot: string,
    private readonly packsRoot: string,
    private readonly sandboxBinary = process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || 'bwrap',
  ) {}

  availability(): SandboxAvailability {
    fs.mkdirSync(this.runtimeRoot, { recursive: true });
    const probeRoot = fs.mkdtempSync(path.join(this.runtimeRoot, '.sandbox-probe-'));
    try {
      const result = spawnSync(
        this.sandboxBinary,
        [
          ...this.isolationArguments(probeRoot),
          '--chdir',
          '/workspace',
          '--setenv',
          'HOME',
          '/workspace',
          '--setenv',
          'TMPDIR',
          '/tmp',
          '--',
          '/bin/sh',
          '-c',
          'if [ "$PWD" != /workspace ]; then echo NEXUS_SANDBOX_PROBE_BAD_CWD >&2; exit 41; fi; if [ -e /var/lib/nexus-agent-runner ]; then echo NEXUS_SANDBOX_PROBE_RUNNER_ROOT_VISIBLE >&2; exit 42; fi',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 2_000,
          env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8' },
        },
      );
      if (!result.error && result.status === 0) {
        this.lastProbeDiagnostic = null;
        return { available: true, reason: null };
      }
      const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
      if (errorCode === 'ENOENT') return { available: false, reason: 'sandbox_binary_unavailable' };
      if (errorCode === 'ETIMEDOUT') return { available: false, reason: 'sandbox_probe_timeout' };
      const rawStderr = String(result.stderr ?? '');
      this.logProbeDiagnostic(result.status, errorCode, rawStderr);
      if (rawStderr.includes('NEXUS_SANDBOX_PROBE_BAD_CWD')) {
        return { available: false, reason: 'sandbox_workdir_isolation_failed' };
      }
      if (rawStderr.includes('NEXUS_SANDBOX_PROBE_RUNNER_ROOT_VISIBLE')) {
        return { available: false, reason: 'sandbox_filesystem_isolation_failed' };
      }
      const stderr = rawStderr.toLowerCase();
      if (stderr.includes('capset') || stderr.includes('capability')) {
        return { available: false, reason: 'sandbox_capability_unavailable' };
      }
      if (stderr.includes('loopback') || stderr.includes('rtm_newaddr')) {
        return { available: false, reason: 'sandbox_network_namespace_unavailable' };
      }
      if (stderr.includes('mount proc') || stderr.includes('procfs')) {
        return { available: false, reason: 'sandbox_proc_mount_unavailable' };
      }
      if (stderr.includes('mount') || stderr.includes('pivot_root')) {
        return { available: false, reason: 'sandbox_mount_unavailable' };
      }
      if (
        stderr.includes('operation not permitted') ||
        stderr.includes('permission denied') ||
        stderr.includes('namespace')
      ) {
        return { available: false, reason: 'sandbox_namespace_unavailable' };
      }
      return { available: false, reason: 'sandbox_probe_failed' };
    } catch {
      return { available: false, reason: 'sandbox_probe_failed' };
    } finally {
      fs.rmSync(probeRoot, { recursive: true, force: true });
    }
  }

  available(): boolean {
    return this.availability().available;
  }

  create(command: EnvironmentCommand): string {
    if (command.network.mode !== 'none') throw new Error('ENVIRONMENT_NETWORK_ENFORCEMENT_UNAVAILABLE');
    const environmentId = safeSegment(command.environmentId);
    const generation = command.generation;
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
    const root = this.environmentRoot(environmentId, generation);
    if (fs.existsSync(root)) throw new Error('ENVIRONMENT_GENERATION_CONFLICT');
    fs.mkdirSync(path.join(root, '.control'), { recursive: true, mode: 0o700 });

    // Workspace data is stable across Environment generations. A generation is a
    // runtime/profile boundary (for example after switching Node/Python/Go versions),
    // not a second copy of the project filesystem.
    const workspace = this.coreWorkspaceRoot(environmentId);
    for (const relative of ['work', 'deps', 'build', 'browser', 'jobs', 'tmp']) {
      fs.mkdirSync(path.join(workspace, relative), { recursive: true, mode: 0o700 });
    }
    fs.mkdirSync(path.join(this.workspaceRoot(environmentId), '.control'), { recursive: true, mode: 0o700 });
    const fingerprint = toolchainFingerprint(command.runtimeDigest, command.packs);
    const profile = this.toolchainProfileRoot(environmentId, fingerprint);
    for (const relative of ['deps/cache/node', 'deps/cache/python', 'deps/cache/go', 'deps/go/pkg/mod', 'build']) {
      fs.mkdirSync(path.join(profile, relative), { recursive: true, mode: 0o700 });
    }
    const metadata: SandboxMetadata = {
      environmentId,
      generation,
      packs: command.packs.map((pack) => ({ ...pack })),
      networkMode: command.network.mode,
      runtimeDigest: command.runtimeDigest,
      toolchainFingerprint: fingerprint,
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
    const workspace = this.coreWorkspaceRoot(metadata.environmentId);
    const fingerprint =
      metadata.toolchainFingerprint ??
      toolchainFingerprint(metadata.runtimeDigest ?? 'legacy-runtime-v0', metadata.packs);
    const profile = this.toolchainProfileRoot(metadata.environmentId, fingerprint);
    for (const relative of ['deps/cache/node', 'deps/cache/python', 'deps/cache/go', 'deps/go/pkg/mod', 'build']) {
      fs.mkdirSync(path.join(profile, relative), { recursive: true, mode: 0o700 });
    }
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

    return {
      file: this.sandboxBinary,
      argv: [
        ...this.isolationArguments(workspace, profile),
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
        'NEXUS_TOOLCHAIN_FINGERPRINT',
        fingerprint,
        '--setenv',
        'NEXUS_DEPS_ROOT',
        '/workspace/deps',
        '--setenv',
        'XDG_CACHE_HOME',
        '/workspace/deps/cache',
        '--setenv',
        'npm_config_cache',
        '/workspace/deps/cache/node/npm',
        '--setenv',
        'npm_config_store_dir',
        '/workspace/deps/cache/node/pnpm-store',
        '--setenv',
        'PIP_CACHE_DIR',
        '/workspace/deps/cache/python/pip',
        '--setenv',
        'PYTHONPYCACHEPREFIX',
        '/workspace/deps/cache/python/pycache',
        '--setenv',
        'GOPATH',
        '/workspace/deps/go',
        '--setenv',
        'GOMODCACHE',
        '/workspace/deps/go/pkg/mod',
        '--setenv',
        'GOCACHE',
        '/workspace/deps/cache/go/build',
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

  workspaceRoot(environmentId: string): string {
    return path.join(this.runtimeRoot, 'workspaces', safeSegment(environmentId));
  }

  coreWorkspaceRoot(environmentId: string): string {
    return path.join(this.workspaceRoot(environmentId), 'core', 'workspace');
  }

  toolchainProfileRoot(environmentId: string, fingerprint: string): string {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('ENVIRONMENT_TOOLCHAIN_FINGERPRINT_INVALID');
    return path.join(this.workspaceRoot(environmentId), 'core', 'toolchains', fingerprint);
  }

  private isolationArguments(workspace: string, profile?: string): string[] {
    const systemBindings = sandboxSystemRuntimeArguments();
    const profileBindings = profile
      ? [
          '--bind',
          path.join(profile, 'deps'),
          '/workspace/deps',
          '--bind',
          path.join(profile, 'build'),
          '/workspace/build',
        ]
      : [];
    return [
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
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
      ...profileBindings,
      '--cap-drop',
      'ALL',
    ];
  }

  private logProbeDiagnostic(status: number | null, errorCode: string | undefined, stderr: string): void {
    if (process.env.NEXUS_AGENT_SANDBOX_DIAGNOSTICS !== '1') return;
    const sanitized = stderr
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\x20-\x7e]/g, '?')
      .trim()
      .slice(0, 512);
    const signature = `${status ?? 'null'}:${errorCode ?? 'none'}:${sanitized}`;
    if (signature === this.lastProbeDiagnostic) return;
    this.lastProbeDiagnostic = signature;
    console.warn(
      `[nexus-agent-runner] sandbox probe failed status=${status ?? 'null'} error=${errorCode ?? 'none'} stderr=${JSON.stringify(sanitized)}`,
    );
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

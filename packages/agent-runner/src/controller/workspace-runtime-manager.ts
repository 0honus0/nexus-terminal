import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolchainPackRef, WorkspaceJobRequest, WorkspaceProvisionCommand } from '../types';
import type { ToolchainStore } from './toolchain-store';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;

export interface WorkspaceExecution {
  file: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface WorkspaceRuntimeMetadata {
  workspaceId: string;
  generation: number;
  toolchain: ToolchainPackRef[];
  runtimeDigest: string;
  toolchainFingerprint: string;
}

const safeSegment = (value: string): string => {
  if (!SAFE_SEGMENT.test(value)) throw new Error('WORKSPACE_ID_INVALID');
  return value;
};

const toolchainFingerprint = (runtimeDigest: string, toolchain: readonly ToolchainPackRef[]): string =>
  createHash('sha256')
    .update(runtimeDigest)
    .update('\u0000')
    .update(
      JSON.stringify(
        [...toolchain]
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

/**
 * 单用户 Runner 的原生 Workspace runtime。
 *
 * Workspace 是持久项目目录，Generation 只记录一次运行环境选择。不同 Workspace
 * 不构成 OS 安全边界；宿主 Runner 共享宿主安全上下文，容器 Runner 共享容器边界。
 */
export class WorkspaceRuntimeManager {
  constructor(
    private readonly runtimeRoot: string,
    private readonly store: ToolchainStore,
  ) {}

  create(command: WorkspaceProvisionCommand): void {
    const workspaceId = safeSegment(command.workspaceId);
    const generation = command.generation;
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
    const root = this.generationRoot(workspaceId, generation);
    if (fs.existsSync(root)) throw new Error('WORKSPACE_GENERATION_CONFLICT');
    fs.mkdirSync(path.join(root, '.control'), { recursive: true, mode: 0o700 });

    const workspace = this.coreWorkspaceRoot(workspaceId);
    for (const relative of ['work', 'browser', 'jobs', 'tmp']) {
      fs.mkdirSync(path.join(workspace, relative), { recursive: true, mode: 0o700 });
    }
    fs.mkdirSync(path.join(this.workspaceRoot(workspaceId), '.control'), { recursive: true, mode: 0o700 });

    const fingerprint = toolchainFingerprint(command.runtimeDigest, command.toolchain);
    const profile = this.toolchainProfileRoot(workspaceId, fingerprint);
    for (const relative of ['deps/cache/node', 'deps/cache/python', 'deps/cache/go', 'deps/go/pkg/mod', 'build']) {
      fs.mkdirSync(path.join(profile, relative), { recursive: true, mode: 0o700 });
    }

    const metadata: WorkspaceRuntimeMetadata = {
      workspaceId,
      generation,
      toolchain: command.toolchain.map((pack) => ({ ...pack })),
      runtimeDigest: command.runtimeDigest,
      toolchainFingerprint: fingerprint,
    };
    this.writeJson(path.join(root, '.control', 'metadata.json'), metadata);
    this.writeState(root, 'ready');
  }

  start(workspaceId: string, generation: number): void {
    this.writeState(this.requireRoot(workspaceId, generation), 'running');
  }

  stop(workspaceId: string, generation: number): void {
    this.writeState(this.requireRoot(workspaceId, generation), 'stopped');
  }

  restart(workspaceId: string, generation: number): void {
    this.writeState(this.requireRoot(workspaceId, generation), 'running');
  }

  remove(workspaceId: string, generation: number): void {
    fs.rmSync(this.generationRoot(workspaceId, generation), { recursive: true, force: true });
  }

  status(workspaceId: string, generation: number): string {
    const root = this.generationRoot(workspaceId, generation);
    if (!fs.existsSync(root)) return 'deleted';
    try {
      return fs.readFileSync(path.join(root, '.control', 'state'), 'utf8').trim() || 'failed';
    } catch {
      return 'failed';
    }
  }

  prepareJob(request: WorkspaceJobRequest): WorkspaceExecution {
    return this.prepareExecution(request.workspaceId, request.generation, request.argv, request.cwd);
  }

  prepareAcpProcess(workspaceId: string, generation: number, argv: readonly string[], cwd: string): WorkspaceExecution {
    return this.prepareExecution(workspaceId, generation, argv, cwd);
  }

  prepareTerminalProcess(workspaceId: string, generation: number): WorkspaceExecution {
    const shell = process.env.SHELL?.trim() || '/bin/sh';
    return this.prepareExecution(workspaceId, generation, [shell, '-l'], '/workspace/work');
  }

  generationRoot(workspaceId: string, generation: number): string {
    if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('WORKSPACE_GENERATION_INVALID');
    return path.join(this.runtimeRoot, 'generations', safeSegment(workspaceId), String(generation));
  }

  workspaceRoot(workspaceId: string): string {
    return path.join(this.runtimeRoot, 'workspaces', safeSegment(workspaceId));
  }

  coreWorkspaceRoot(workspaceId: string): string {
    return path.join(this.workspaceRoot(workspaceId), 'core', 'workspace');
  }

  toolchainProfileRoot(workspaceId: string, fingerprint: string): string {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('WORKSPACE_TOOLCHAIN_FINGERPRINT_INVALID');
    return path.join(this.workspaceRoot(workspaceId), 'core', 'toolchains', fingerprint);
  }

  private prepareExecution(
    workspaceId: string,
    generation: number,
    argv: readonly string[],
    cwd: string,
  ): WorkspaceExecution {
    if (!Array.isArray(argv) || argv.length < 1 || argv.length > 128) throw new Error('VALIDATION_FAILED');
    if (argv.some((item) => typeof item !== 'string' || item.includes('\0'))) throw new Error('VALIDATION_FAILED');
    const root = this.requireRoot(workspaceId, generation);
    if (this.status(workspaceId, generation) !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    const metadata = this.readMetadata(root);
    if (metadata.workspaceId !== workspaceId || metadata.generation !== generation) {
      throw new Error('WORKSPACE_IDENTITY_MISMATCH');
    }

    const workspace = this.coreWorkspaceRoot(metadata.workspaceId);
    const profile = this.toolchainProfileRoot(metadata.workspaceId, metadata.toolchainFingerprint);
    const packBins: string[] = [];
    for (const pack of metadata.toolchain) {
      if (!this.store.installed(pack)) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
      this.store.activate(pack);
      const target = this.store.canonicalPath(pack);
      if (fs.existsSync(path.join(target, 'bin'))) packBins.push(path.join(target, 'bin'));
    }

    const depsRoot = path.join(profile, 'deps');
    const buildRoot = path.join(profile, 'build');
    const tmpRoot = path.join(workspace, 'tmp');
    const resolvedCwd = this.resolveLogicalPath(cwd, workspace, depsRoot, buildRoot);
    fs.mkdirSync(resolvedCwd, { recursive: true, mode: 0o700 });

    return {
      file: argv[0]!,
      argv: [...argv.slice(1)],
      cwd: resolvedCwd,
      env: {
        HOME: workspace,
        TMPDIR: tmpRoot,
        LANG: process.env.LANG ?? 'C.UTF-8',
        TERM: process.env.TERM ?? 'xterm-256color',
        PATH: [...packBins, '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
        NEXUS_WORKSPACE_ROOT: workspace,
        NEXUS_TOOLCHAIN_FINGERPRINT: metadata.toolchainFingerprint,
        NEXUS_DEPS_ROOT: depsRoot,
        XDG_CACHE_HOME: path.join(depsRoot, 'cache'),
        npm_config_cache: path.join(depsRoot, 'cache', 'node', 'npm'),
        npm_config_store_dir: path.join(depsRoot, 'cache', 'node', 'pnpm-store'),
        PIP_CACHE_DIR: path.join(depsRoot, 'cache', 'python', 'pip'),
        PYTHONPYCACHEPREFIX: path.join(depsRoot, 'cache', 'python', 'pycache'),
        GOPATH: path.join(depsRoot, 'go'),
        GOMODCACHE: path.join(depsRoot, 'go', 'pkg', 'mod'),
        GOCACHE: path.join(depsRoot, 'cache', 'go', 'build'),
        GOTOOLCHAIN: 'local',
      },
    };
  }

  private resolveLogicalPath(value: string, workspace: string, depsRoot: string, buildRoot: string): string {
    const logical = path.posix.normalize(value.startsWith('/') ? value : `/workspace/${value}`);
    if (logical !== '/workspace' && !logical.startsWith('/workspace/')) throw new Error('JOB_CWD_FORBIDDEN');
    if (logical.includes('\0')) throw new Error('JOB_CWD_FORBIDDEN');
    if (logical === '/workspace') return workspace;
    if (logical === '/workspace/deps' || logical.startsWith('/workspace/deps/')) {
      return path.join(depsRoot, ...logical.slice('/workspace/deps'.length).split('/').filter(Boolean));
    }
    if (logical === '/workspace/build' || logical.startsWith('/workspace/build/')) {
      return path.join(buildRoot, ...logical.slice('/workspace/build'.length).split('/').filter(Boolean));
    }
    return path.join(workspace, ...logical.slice('/workspace/'.length).split('/').filter(Boolean));
  }

  private requireRoot(workspaceId: string, generation: number): string {
    const root = this.generationRoot(workspaceId, generation);
    if (!fs.existsSync(root)) throw new Error('WORKSPACE_NOT_FOUND');
    return root;
  }

  private readMetadata(root: string): WorkspaceRuntimeMetadata {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, '.control', 'metadata.json'), 'utf8'),
    ) as WorkspaceRuntimeMetadata;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.workspaceId !== 'string' ||
      !Number.isSafeInteger(parsed.generation) ||
      !Array.isArray(parsed.toolchain) ||
      typeof parsed.runtimeDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.toolchainFingerprint)
    ) {
      throw new Error('WORKSPACE_METADATA_INVALID');
    }
    return parsed;
  }

  private writeState(root: string, state: 'ready' | 'running' | 'stopped'): void {
    fs.writeFileSync(path.join(root, '.control', 'state'), `${state}\n`, { mode: 0o600 });
  }

  private writeJson(file: string, value: unknown): void {
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  }
}

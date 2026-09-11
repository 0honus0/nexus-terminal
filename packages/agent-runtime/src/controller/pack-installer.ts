import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import semver from 'semver';
import type { CatalogPack, ToolchainPackRef } from '../types';
import type { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import type { ToolchainStore } from './toolchain-store';
import { sandboxResolverRuntimeArguments, sandboxSystemRuntimeArguments } from './sandbox-system-runtime';

const RUNNER_API_VERSION = '1.0.0';
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 16_384;
const MAX_DEPTH = 32;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MISE_VERSION = '2026.9.5';
const MISE_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MISE_OUTPUT_BYTES = 64 * 1024;
const MAX_RELOCATABLE_TEXT_BYTES = 8 * 1024 * 1024;
const INSTALL_STAGING_PATH = '/nexus-staging';
const INSTALL_MISE_ROOT = '/nexus-mise';

interface PackManifest {
  schemaVersion: 1;
  familyId: string;
  versionId: string;
  architecture: string;
  capabilities: string[];
  runnerApiRange: string;
  dependencies: Array<{ familyId: string; versionId: string }>;
}

const safeSegment = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error('WORKSPACE_TOOLCHAIN_REF_INVALID');
  return value;
};

const safeArchivePath = (raw: string): string => {
  if (!raw || raw.includes('\0') || raw.includes('\\') || path.posix.isAbsolute(raw)) {
    throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '') return '.';
  if (normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
  }
  if (normalized.split('/').length > MAX_DEPTH) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_TOO_DEEP');
  return normalized;
};

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const sameDependencies = (
  a: readonly { familyId: string; versionId: string }[],
  b: readonly { familyId: string; versionId: string }[],
): boolean =>
  JSON.stringify(
    [...a].sort((x, y) => `${x.familyId}/${x.versionId}`.localeCompare(`${y.familyId}/${y.versionId}`)),
  ) ===
  JSON.stringify([...b].sort((x, y) => `${x.familyId}/${x.versionId}`.localeCompare(`${y.familyId}/${y.versionId}`)));

const fsyncFile = (filePath: string): void => {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

const lockAndSyncTree = (root: string): void => {
  const visit = (current: string, isRoot = false): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      safeSymlink(root, current);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) visit(path.join(current, name));
      if (!isRoot) fs.chmodSync(current, 0o555);
      fsyncFile(current);
      return;
    }
    if (!stat.isFile()) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
    fs.chmodSync(current, stat.mode & 0o111 ? 0o555 : 0o444);
    fsyncFile(current);
  };
  visit(root, true);
};

const hashFile = async (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });

const canonicalPackTarget = (pack: Pick<CatalogPack, 'familyId' | 'versionId'>): string =>
  `/opt/nexus/packs/${safeSegment(pack.familyId)}/${safeSegment(pack.versionId)}`;

const safeSymlink = (root: string, linkPath: string): string => {
  const target = fs.readlinkSync(linkPath);
  if (!target || path.isAbsolute(target) || target.includes('\0'))
    throw new Error('WORKSPACE_TOOLCHAIN_SYMLINK_UNSAFE');
  const resolved = path.resolve(path.dirname(linkPath), target);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('WORKSPACE_TOOLCHAIN_SYMLINK_UNSAFE');
  }
  return target.replace(/\\/g, '/');
};

const normalizedTreeDigest = (root: string): string => {
  const hash = createHash('sha256');
  const visit = (current: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        const link = safeSymlink(root, target);
        hash.update(`L\0${relative}\0${0}\0`);
        hash.update(createHash('sha256').update(link).digest());
        continue;
      }
      if (stat.isDirectory()) {
        hash.update(`D\0${relative}\0${0}\0`);
        visit(target);
        continue;
      }
      if (!stat.isFile()) throw new Error('WORKSPACE_TOOLCHAIN_TREE_UNSAFE');
      hash.update(`F\0${relative}\0${stat.mode & 0o111 ? 1 : 0}\0`);
      hash.update(createHash('sha256').update(fs.readFileSync(target)).digest());
    }
  };
  visit(root);
  return `sha256:${hash.digest('hex')}`;
};

const relocateTextTree = (root: string, sourcePrefix: string, targetPrefix: string): void => {
  const sourceBytes = Buffer.from(sourcePrefix);
  const visit = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const target = path.join(current, name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        safeSymlink(root, target);
        continue;
      }
      if (stat.isDirectory()) {
        visit(target);
        continue;
      }
      if (!stat.isFile()) throw new Error('WORKSPACE_TOOLCHAIN_TREE_UNSAFE');
      const value = fs.readFileSync(target);
      if (value.indexOf(sourceBytes) < 0) continue;
      if (value.length > MAX_RELOCATABLE_TEXT_BYTES || !isUtf8(value) || value.includes(0)) {
        throw new Error('WORKSPACE_TOOLCHAIN_NOT_RELOCATABLE');
      }
      const updated = value.toString('utf8').split(sourcePrefix).join(targetPrefix);
      fs.writeFileSync(target, updated, { mode: stat.mode & 0o777 });
    }
  };
  visit(root);
};

const runProcess = async (
  file: string,
  argv: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, argv, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let killedForOutput = false;
    const terminate = (): void => {
      child.kill('SIGKILL');
    };
    const append = (current: Buffer, chunk: Buffer): Buffer => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_MISE_OUTPUT_BYTES) {
        killedForOutput = true;
        terminate();
        return next.subarray(0, MAX_MISE_OUTPUT_BYTES);
      }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, Buffer.from(chunk))));
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, Buffer.from(chunk))));
    const timer = setTimeout(terminate, options.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !killedForOutput) {
        resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
        return;
      }
      const diagnostic = stderr
        .toString('utf8')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2048);
      if (diagnostic) process.stderr.write(`[nexus-agent-runner] isolated tool materializer failed: ${diagnostic}\n`);
      reject(
        new Error(
          killedForOutput
            ? 'WORKSPACE_TOOLCHAIN_INSTALL_OUTPUT_TOO_LARGE'
            : signal
              ? 'WORKSPACE_TOOLCHAIN_INSTALL_TERMINATED'
              : `WORKSPACE_TOOLCHAIN_INSTALL_FAILED:${code ?? 'unknown'}`,
        ),
      );
    });
  });

/** Catalog-bound installer. Sources are never accepted from ordinary HTTP/API input. */
export class PackInstaller {
  constructor(
    private readonly catalog: WorkspaceRuntimeCatalog,
    private readonly store: ToolchainStore,
    private readonly cacheRoot: string,
    private readonly sandboxBinary = process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || 'bwrap',
  ) {
    fs.mkdirSync(path.join(cacheRoot, 'download'), { recursive: true });
    fs.mkdirSync(path.join(cacheRoot, 'mise'), { recursive: true });
  }

  installed(ref: ToolchainPackRef): boolean {
    return this.store.installed(ref);
  }

  async uninstall(ref: ToolchainPackRef): Promise<void> {
    const pack = this.catalog.pack(ref.familyId, ref.versionId);
    const expected = pack.contentDigestByArch[process.arch];
    if (!expected || expected !== ref.contentDigest) throw new Error('WORKSPACE_TOOLCHAIN_DIGEST_MISMATCH');
    this.store.remove(ref);
  }

  async ensure(refs: readonly ToolchainPackRef[], commandId: string = randomUUID()): Promise<void> {
    const expanded = this.expandDependencies(refs);
    for (const ref of expanded) {
      const pack = this.catalog.pack(ref.familyId, ref.versionId);
      const expected = pack.contentDigestByArch[process.arch];
      if (!expected || expected !== ref.contentDigest || !/^sha256:[a-f0-9]{64}$/.test(expected)) {
        throw new Error('WORKSPACE_TOOLCHAIN_DIGEST_MISMATCH');
      }
      if (this.store.installed(ref)) continue;
      await this.installOne(pack, ref, commandId);
    }
  }

  private expandDependencies(refs: readonly ToolchainPackRef[]): ToolchainPackRef[] {
    const result: ToolchainPackRef[] = [];
    const visiting = new Set<string>();
    const complete = new Set<string>();
    const visit = (ref: ToolchainPackRef): void => {
      const key = `${ref.familyId}/${ref.versionId}/${ref.contentDigest}`;
      if (complete.has(key)) return;
      if (visiting.has(key)) throw new Error('WORKSPACE_TOOLCHAIN_DEPENDENCY_CYCLE');
      visiting.add(key);
      const pack = this.catalog.pack(ref.familyId, ref.versionId);
      const expected = pack.contentDigestByArch[process.arch];
      if (!expected || expected !== ref.contentDigest) throw new Error('WORKSPACE_TOOLCHAIN_DIGEST_MISMATCH');
      for (const dependency of pack.dependencies) {
        const child = this.catalog.pack(dependency.familyId, dependency.versionId);
        const digest = child.contentDigestByArch[process.arch];
        if (!digest) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
        visit({ familyId: dependency.familyId, versionId: dependency.versionId, contentDigest: digest });
      }
      visiting.delete(key);
      complete.add(key);
      result.push(ref);
    };
    for (const ref of refs) visit(ref);
    return result;
  }

  private sourcePath(pack: CatalogPack): string {
    const architecture = process.arch;
    const downloadRef = pack.downloadRefByArch[architecture];
    const expectedRef = `builtin://${pack.familyId}/${pack.versionId}/${architecture}`;
    if (downloadRef !== expectedRef) throw new Error('WORKSPACE_TOOLCHAIN_SOURCE_UNSUPPORTED');
    const source = this.catalog.catalogPath(
      'builtin-packs',
      safeSegment(pack.familyId),
      safeSegment(pack.versionId),
      `${safeSegment(architecture)}.tar`,
    );
    if (!fs.existsSync(source)) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
      throw new Error('WORKSPACE_TOOLCHAIN_SOURCE_INVALID');
    }
    return source;
  }

  private async cachedArchive(pack: CatalogPack, ref: ToolchainPackRef, commandId: string): Promise<string> {
    const directory = path.join(this.cacheRoot, 'download', safeSegment(commandId));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const archive = path.join(
      directory,
      `${safeSegment(pack.familyId)}-${safeSegment(pack.versionId)}-${safeSegment(process.arch)}.tar`,
    );
    if (fs.existsSync(archive) && (await hashFile(archive)) === ref.contentDigest) return archive;
    const temporary = `${archive}.part`;
    fs.rmSync(temporary, { force: true });
    fs.copyFileSync(this.sourcePath(pack), temporary, fs.constants.COPYFILE_EXCL);
    const stat = fs.lstatSync(temporary);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
      fs.rmSync(temporary, { force: true });
      throw new Error('WORKSPACE_TOOLCHAIN_SOURCE_INVALID');
    }
    const digest = await hashFile(temporary);
    if (digest !== ref.contentDigest) {
      fs.rmSync(temporary, { force: true });
      throw new Error('WORKSPACE_TOOLCHAIN_DIGEST_MISMATCH');
    }
    fsyncFile(temporary);
    fs.rmSync(archive, { force: true });
    fs.renameSync(temporary, archive);
    return archive;
  }

  private async validateArchive(archive: string, pack: CatalogPack): Promise<void> {
    let entries = 0;
    let expandedBytes = 0;
    const seen = new Set<string>();
    const expandedLimit = Math.min(MAX_EXPANDED_BYTES, Math.max(1024 * 1024, pack.diskBytes * 8));
    await tar.t({
      file: archive,
      strict: true,
      maxDecompressionRatio: 100,
      onentry: (entry) => {
        entries += 1;
        if (entries > MAX_ENTRIES) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_TOO_MANY_FILES');
        const normalized = safeArchivePath(entry.path);
        if (normalized !== '.') {
          if (seen.has(normalized)) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_DUPLICATE_PATH');
          seen.add(normalized);
        }
        if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
        if (entry.linkpath) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
        if (entry.type === 'File') {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SINGLE_FILE_BYTES) {
            throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_FILE_TOO_LARGE');
          }
          expandedBytes += entry.size;
          if (expandedBytes > expandedLimit) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_TOO_LARGE');
        }
      },
    });
    if (!seen.has('pack.json')) throw new Error('WORKSPACE_TOOLCHAIN_MANIFEST_MISSING');
  }

  private verifyManifest(staging: string, pack: CatalogPack): void {
    const manifestPath = path.join(staging, 'pack.json');
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error('WORKSPACE_TOOLCHAIN_MANIFEST_INVALID');
    }
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackManifest;
    } catch {
      throw new Error('WORKSPACE_TOOLCHAIN_MANIFEST_INVALID');
    }
    if (
      manifest.schemaVersion !== 1 ||
      manifest.familyId !== pack.familyId ||
      manifest.versionId !== pack.versionId ||
      manifest.architecture !== process.arch ||
      !Array.isArray(manifest.capabilities) ||
      !sameStrings(manifest.capabilities, pack.capabilities) ||
      manifest.runnerApiRange !== pack.runnerApiRange ||
      !semver.validRange(manifest.runnerApiRange) ||
      !semver.satisfies(RUNNER_API_VERSION, manifest.runnerApiRange) ||
      !Array.isArray(manifest.dependencies) ||
      !sameDependencies(manifest.dependencies, pack.dependencies)
    ) {
      throw new Error('WORKSPACE_TOOLCHAIN_MANIFEST_INVALID');
    }
  }

  private async installOne(pack: CatalogPack, ref: ToolchainPackRef, commandId: string): Promise<void> {
    const source = pack.downloadRefByArch[process.arch] ?? '';
    if (source.startsWith('mise://')) {
      await this.installMise(pack, ref, commandId, source);
      return;
    }
    await this.installBuiltin(pack, ref, commandId);
  }

  private async installMise(
    pack: CatalogPack,
    ref: ToolchainPackRef,
    commandId: string,
    source: string,
  ): Promise<void> {
    if (!['node', 'python', 'go'].includes(pack.familyId)) throw new Error('WORKSPACE_TOOLCHAIN_SOURCE_UNSUPPORTED');
    const expectedSource = `mise://${MISE_VERSION}/${pack.familyId}/${pack.versionId}`;
    if (source !== expectedSource) throw new Error('WORKSPACE_TOOLCHAIN_SOURCE_UNSUPPORTED');
    const staging = this.store.stagingPath(commandId, ref);
    fs.rmSync(staging, { recursive: true, force: true });
    const miseRoot = path.join(this.cacheRoot, 'mise');
    const working = path.join(miseRoot, 'work');
    fs.mkdirSync(working, { recursive: true, mode: 0o700 });
    const miseBin =
      process.env.NEXUS_AGENT_MISE_BIN?.trim() || `/usr/local/lib/nexus-agent-runner/mise/${MISE_VERSION}/bin/mise`;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: path.join(miseRoot, 'home'),
      MISE_CACHE_DIR: path.join(miseRoot, 'cache'),
      MISE_DATA_DIR: path.join(miseRoot, 'data'),
      MISE_STATE_DIR: path.join(miseRoot, 'state'),
      MISE_CONFIG_DIR: path.join(miseRoot, 'config'),
      MISE_NO_CONFIG: '1',
      MISE_YES: '1',
    };
    for (const directory of [
      env.HOME,
      env.MISE_CACHE_DIR,
      env.MISE_DATA_DIR,
      env.MISE_STATE_DIR,
      env.MISE_CONFIG_DIR,
    ]) {
      if (directory) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    try {
      const version = await runProcess(miseBin, ['--version'], { cwd: working, env, timeoutMs: 10_000 });
      if (!version.stdout.trim().startsWith(MISE_VERSION))
        throw new Error('WORKSPACE_TOOLCHAIN_INSTALLER_VERSION_MISMATCH');
      fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
      await this.materializeWithMiseSandbox(miseBin, miseRoot, staging, pack);
      relocateTextTree(staging, INSTALL_STAGING_PATH, canonicalPackTarget(pack));
      await this.verifyMiseVersion(staging, pack);
      const manifest: PackManifest = {
        schemaVersion: 1,
        familyId: pack.familyId,
        versionId: pack.versionId,
        architecture: process.arch,
        capabilities: [...pack.capabilities],
        runnerApiRange: pack.runnerApiRange,
        dependencies: pack.dependencies.map((dependency) => ({ ...dependency })),
      };
      fs.writeFileSync(path.join(staging, 'pack.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o644 });
      this.verifyManifest(staging, pack);
      const digest = normalizedTreeDigest(staging);
      if (digest !== ref.contentDigest) throw new Error('WORKSPACE_TOOLCHAIN_DIGEST_MISMATCH');
      this.store.writeMarker(staging, ref, Math.floor(Date.now() / 1000));
      lockAndSyncTree(staging);
      this.store.commit(staging, ref);
    } catch (error) {
      this.store.discardStaging(staging);
      throw error;
    }
  }

  private async materializeWithMiseSandbox(
    miseBin: string,
    miseRoot: string,
    staging: string,
    pack: CatalogPack,
  ): Promise<void> {
    const sandboxBinary = this.sandboxBinary;
    const systemBindings = sandboxSystemRuntimeArguments();
    const resolverBindings = sandboxResolverRuntimeArguments();
    const args = [
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      ...systemBindings,
      ...resolverBindings,
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--dir',
      '/nexus-installer',
      '--ro-bind',
      miseBin,
      '/nexus-installer/mise',
      '--bind',
      miseRoot,
      INSTALL_MISE_ROOT,
      '--bind',
      staging,
      INSTALL_STAGING_PATH,
      '--dir',
      '/work',
      '--chdir',
      '/work',
      '--setenv',
      'HOME',
      `${INSTALL_MISE_ROOT}/home`,
      '--setenv',
      'MISE_CACHE_DIR',
      `${INSTALL_MISE_ROOT}/cache`,
      '--setenv',
      'MISE_DATA_DIR',
      `${INSTALL_MISE_ROOT}/data`,
      '--setenv',
      'MISE_STATE_DIR',
      `${INSTALL_MISE_ROOT}/state`,
      '--setenv',
      'MISE_CONFIG_DIR',
      `${INSTALL_MISE_ROOT}/config`,
      '--setenv',
      'MISE_NO_CONFIG',
      '1',
      '--setenv',
      'MISE_YES',
      '1',
      '--setenv',
      'PATH',
      '/usr/local/bin:/usr/bin:/bin',
      '--cap-drop',
      'ALL',
      '--',
      '/nexus-installer/mise',
      'install-into',
      `${pack.familyId}@${pack.versionId}`,
      INSTALL_STAGING_PATH,
    ];
    await runProcess(sandboxBinary, args, {
      cwd: '/',
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8' },
      timeoutMs: MISE_INSTALL_TIMEOUT_MS,
    });
  }

  private async verifyMiseVersion(staging: string, pack: CatalogPack): Promise<void> {
    const relativeExecutable =
      pack.familyId === 'node' ? 'bin/node' : pack.familyId === 'python' ? 'bin/python3' : 'bin/go';
    const executable = path.join(staging, relativeExecutable);
    if (!fs.existsSync(executable)) throw new Error('WORKSPACE_TOOLCHAIN_INSTALL_INVALID');
    if (fs.lstatSync(executable).isSymbolicLink()) safeSymlink(staging, executable);
    const resolvedExecutable = fs.realpathSync(executable);
    const resolvedRoot = fs.realpathSync(staging);
    if (
      (resolvedExecutable !== resolvedRoot && !resolvedExecutable.startsWith(`${resolvedRoot}${path.sep}`)) ||
      !fs.statSync(resolvedExecutable).isFile() ||
      (fs.statSync(resolvedExecutable).mode & 0o111) === 0
    ) {
      throw new Error('WORKSPACE_TOOLCHAIN_INSTALL_INVALID');
    }

    const target = canonicalPackTarget(pack);
    const parentSegments = target.split('/').filter(Boolean);
    const targetParentArgs: string[] = [];
    let current = '';
    for (const segment of parentSegments.slice(0, -1)) {
      current += `/${segment}`;
      targetParentArgs.push('--dir', current);
    }
    const result = await runProcess(
      this.sandboxBinary,
      [
        '--die-with-parent',
        '--new-session',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--unshare-net',
        ...sandboxSystemRuntimeArguments(),
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        ...targetParentArgs,
        '--ro-bind',
        staging,
        target,
        '--setenv',
        'PATH',
        `${target}/bin:/usr/local/bin:/usr/bin:/bin`,
        '--setenv',
        'GOTOOLCHAIN',
        'local',
        '--cap-drop',
        'ALL',
        '--',
        `${target}/${relativeExecutable}`,
        ...(pack.familyId === 'go' ? ['version'] : ['--version']),
      ],
      {
        cwd: '/',
        env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG ?? 'C.UTF-8' },
        timeoutMs: 10_000,
      },
    );
    const output = `${result.stdout}${result.stderr}`.trim();
    const valid =
      pack.familyId === 'node'
        ? output === `v${pack.versionId}`
        : pack.familyId === 'python'
          ? output === `Python ${pack.versionId}`
          : output.includes(`go${pack.versionId} `);
    if (!valid) throw new Error('WORKSPACE_TOOLCHAIN_INSTALL_VERSION_MISMATCH');
  }

  private async installBuiltin(pack: CatalogPack, ref: ToolchainPackRef, commandId: string): Promise<void> {
    const archive = await this.cachedArchive(pack, ref, commandId);
    await this.validateArchive(archive, pack);
    const staging = this.store.stagingPath(commandId, ref);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    try {
      await tar.x({
        file: archive,
        cwd: staging,
        strict: true,
        preservePaths: false,
        preserveOwner: false,
        noMtime: true,
        unlink: true,
        maxDepth: MAX_DEPTH,
        maxDecompressionRatio: 100,
        onentry: (entry) => {
          safeArchivePath(entry.path);
          if (entry.type !== 'File' && entry.type !== 'Directory') {
            throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
          }
          if (entry.linkpath) throw new Error('WORKSPACE_TOOLCHAIN_ARCHIVE_UNSAFE');
        },
      });
      this.verifyManifest(staging, pack);
      this.store.writeMarker(staging, ref, Math.floor(Date.now() / 1000));
      lockAndSyncTree(staging);
      this.store.commit(staging, ref);
    } catch (error) {
      this.store.discardStaging(staging);
      throw error;
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import type { ToolchainPackRef } from '../types';

const safeSegment = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error('WORKSPACE_TOOLCHAIN_REF_INVALID');
  return value;
};

interface InstallMarker {
  schemaVersion: 1;
  contentDigest: string;
  installedAt: number;
}

const decodeInstallMarker = (value: unknown): InstallMarker => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('WORKSPACE_TOOLCHAIN_MARKER_INVALID');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.contentDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(record.contentDigest) ||
    !Number.isSafeInteger(record.installedAt) ||
    Number(record.installedAt) < 0
  ) {
    throw new Error('WORKSPACE_TOOLCHAIN_MARKER_INVALID');
  }
  return { schemaVersion: 1, contentDigest: record.contentDigest, installedAt: Number(record.installedAt) };
};

const markerName = '.nexus-install.json';
const runtimeViewMarkerName = '.nexus-runtime-view.json';
const MAX_RELOCATABLE_TEXT_BYTES = 8 * 1024 * 1024;

interface RuntimeViewMarker {
  schemaVersion: 1;
  contentDigest: string;
  executionPath: string;
}

const makeTreeWritable = (root: string): void => {
  if (!fs.existsSync(root)) return;
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) visit(path.join(current, name));
      return;
    }
    if (stat.isFile()) fs.chmodSync(current, 0o600 | (stat.mode & 0o111));
  };
  visit(root);
};

const lockTree = (root: string): void => {
  const visit = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) visit(path.join(current, name));
      fs.chmodSync(current, 0o555);
      return;
    }
    if (!stat.isFile()) throw new Error('WORKSPACE_TOOLCHAIN_TREE_UNSAFE');
    fs.chmodSync(current, stat.mode & 0o111 ? 0o555 : 0o444);
  };
  visit(root);
};

const assertSafeSymlink = (root: string, linkPath: string): void => {
  const target = fs.readlinkSync(linkPath);
  if (!target || path.isAbsolute(target) || target.includes('\0')) {
    throw new Error('WORKSPACE_TOOLCHAIN_SYMLINK_UNSAFE');
  }
  const resolved = path.resolve(path.dirname(linkPath), target);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('WORKSPACE_TOOLCHAIN_SYMLINK_UNSAFE');
  }
};

const relocateRuntimeTree = (root: string, sourcePrefix: string, targetPrefix: string): void => {
  const sourceBytes = Buffer.from(sourcePrefix);
  const visit = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const target = path.join(current, name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        assertSafeSymlink(root, target);
        continue;
      }
      if (stat.isDirectory()) {
        visit(target);
        continue;
      }
      if (!stat.isFile()) throw new Error('WORKSPACE_TOOLCHAIN_TREE_UNSAFE');
      const value = fs.readFileSync(target);
      if (value.indexOf(sourceBytes) < 0) continue;
      const decoded = value.toString('utf8');
      if (
        value.length > MAX_RELOCATABLE_TEXT_BYTES ||
        value.includes(0) ||
        !Buffer.from(decoded, 'utf8').equals(value)
      ) {
        throw new Error('WORKSPACE_TOOLCHAIN_NOT_RELOCATABLE');
      }
      fs.writeFileSync(target, decoded.split(sourcePrefix).join(targetPrefix), { mode: stat.mode & 0o777 });
    }
  };
  visit(root);
};

const canonicalRoot = '/opt/nexus/packs';

const removeManagedTree = (target: string): void => {
  if (!fs.existsSync(target)) return;
  makeTreeWritable(target);
  fs.rmSync(target, { recursive: true, force: true });
};

export class ToolchainStore {
  constructor(private readonly packsRoot: string) {
    fs.mkdirSync(packsRoot, { recursive: true });
    const stagingRoot = path.join(packsRoot, '.staging');
    removeManagedTree(stagingRoot);
    fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(packsRoot, '.runtime'), { recursive: true });
  }

  path(ref: ToolchainPackRef): string {
    return path.join(
      this.packsRoot,
      safeSegment(ref.familyId),
      safeSegment(ref.versionId),
      safeSegment(ref.contentDigest.replace(/^sha256:/, '')),
    );
  }

  canonicalPath(ref: Pick<ToolchainPackRef, 'familyId' | 'versionId'>): string {
    return path.join(canonicalRoot, safeSegment(ref.familyId), safeSegment(ref.versionId));
  }

  executionPath(ref: ToolchainPackRef): string {
    if (!this.installed(ref)) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    const target = path.join(
      this.packsRoot,
      '.runtime',
      safeSegment(ref.familyId),
      safeSegment(ref.versionId),
      safeSegment(ref.contentDigest.replace(/^sha256:/, '')),
    );
    const markerPath = path.join(target, runtimeViewMarkerName);
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Partial<RuntimeViewMarker>;
      if (
        marker.schemaVersion === 1 &&
        marker.contentDigest === ref.contentDigest &&
        marker.executionPath === target &&
        (fs.statSync(target).mode & 0o200) === 0
      ) {
        return target;
      }
    } catch {
      // Missing or incomplete runtime views are rebuilt from the verified immutable source pack.
    }

    removeManagedTree(target);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    const staging = `${target}.staging`;
    removeManagedTree(staging);
    fs.cpSync(this.path(ref), staging, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: false,
      errorOnExist: true,
    });
    makeTreeWritable(staging);
    relocateRuntimeTree(staging, this.canonicalPath(ref), target);
    const marker: RuntimeViewMarker = { schemaVersion: 1, contentDigest: ref.contentDigest, executionPath: target };
    fs.writeFileSync(path.join(staging, runtimeViewMarkerName), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    lockTree(staging);
    fs.renameSync(staging, target);
    return target;
  }

  activate(ref: ToolchainPackRef): void {
    if (!this.installed(ref)) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    const target = this.path(ref);
    const canonical = this.canonicalPath(ref);
    fs.mkdirSync(path.dirname(canonical), { recursive: true, mode: 0o755 });
    const temporary = `${canonical}.nexus-${process.pid}-${Date.now()}`;
    fs.rmSync(temporary, { force: true, recursive: true });
    fs.symlinkSync(target, temporary, 'dir');
    try {
      const stat = fs.lstatSync(canonical);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        fs.rmSync(temporary, { force: true });
        throw new Error('WORKSPACE_TOOLCHAIN_CANONICAL_PATH_CONFLICT');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        fs.rmSync(temporary, { force: true });
        throw error;
      }
    }
    fs.renameSync(temporary, canonical);
  }

  stagingPath(commandId: string, ref: ToolchainPackRef): string {
    const digest = safeSegment(ref.contentDigest.replace(/^sha256:/, '')).slice(0, 16);
    return path.join(
      this.packsRoot,
      '.staging',
      `${safeSegment(commandId)}-${safeSegment(ref.familyId)}-${safeSegment(ref.versionId)}-${digest}`,
    );
  }

  installed(ref: ToolchainPackRef): boolean {
    const marker = path.join(this.path(ref), markerName);
    try {
      const parsed = decodeInstallMarker(JSON.parse(fs.readFileSync(marker, 'utf8')) as unknown);
      const rootMode = fs.statSync(this.path(ref)).mode & 0o777;
      return parsed.schemaVersion === 1 && parsed.contentDigest === ref.contentDigest && (rootMode & 0o200) === 0;
    } catch {
      return false;
    }
  }

  writeMarker(stagingPath: string, ref: ToolchainPackRef, installedAt: number): void {
    const marker: InstallMarker = { schemaVersion: 1, contentDigest: ref.contentDigest, installedAt };
    fs.writeFileSync(path.join(stagingPath, markerName), `${JSON.stringify(marker)}\n`, { mode: 0o444 });
  }

  commit(stagingPath: string, ref: ToolchainPackRef): void {
    const target = this.path(ref);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    if (this.installed(ref)) {
      removeManagedTree(stagingPath);
      return;
    }
    removeManagedTree(target);
    fs.renameSync(stagingPath, target);
    fs.chmodSync(target, 0o555);
    const fd = fs.openSync(target, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  discardStaging(stagingPath: string): void {
    const stagingRoot = path.join(this.packsRoot, '.staging') + path.sep;
    const resolved = path.resolve(stagingPath);
    if (!resolved.startsWith(path.resolve(stagingRoot) + path.sep) && resolved !== path.resolve(stagingRoot)) {
      throw new Error('WORKSPACE_TOOLCHAIN_REF_INVALID');
    }
    removeManagedTree(resolved);
  }

  discardCommandStaging(commandId: string): number {
    const stagingRoot = path.join(this.packsRoot, '.staging');
    const prefix = `${safeSegment(commandId)}-`;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.name.startsWith(prefix)) continue;
      try {
        removeManagedTree(path.join(stagingRoot, entry.name));
        removed += 1;
      } catch {
        // Startup sweep is the durable fallback for a transient terminal cleanup failure.
      }
    }
    return removed;
  }

  remove(ref: ToolchainPackRef): void {
    const target = this.path(ref);
    const runtimeView = path.join(
      this.packsRoot,
      '.runtime',
      safeSegment(ref.familyId),
      safeSegment(ref.versionId),
      safeSegment(ref.contentDigest.replace(/^sha256:/, '')),
    );
    removeManagedTree(runtimeView);
    removeManagedTree(`${runtimeView}.staging`);
    const canonical = this.canonicalPath(ref);
    try {
      if (fs.lstatSync(canonical).isSymbolicLink() && fs.realpathSync(canonical) === fs.realpathSync(target)) {
        fs.rmSync(canonical, { force: true });
      }
    } catch {
      // canonical link may already be absent or broken.
    }
    removeManagedTree(target);
  }
}

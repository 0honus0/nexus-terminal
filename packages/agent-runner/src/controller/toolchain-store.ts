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

const markerName = '.nexus-install.json';

const removeManagedTree = (target: string): void => {
  if (!fs.existsSync(target)) return;
  const makeWritable = (current: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) makeWritable(path.join(current, name));
      return;
    }
    if (stat.isFile()) fs.chmodSync(current, 0o600);
  };
  makeWritable(target);
  fs.rmSync(target, { recursive: true, force: true });
};

export class ToolchainStore {
  constructor(private readonly packsRoot: string) {
    fs.mkdirSync(packsRoot, { recursive: true });
    fs.mkdirSync(path.join(packsRoot, '.staging'), { recursive: true });
  }

  path(ref: ToolchainPackRef): string {
    return path.join(
      this.packsRoot,
      safeSegment(ref.familyId),
      safeSegment(ref.versionId),
      safeSegment(ref.contentDigest.replace(/^sha256:/, '')),
    );
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
      const parsed = JSON.parse(fs.readFileSync(marker, 'utf8')) as Partial<InstallMarker>;
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

  remove(ref: ToolchainPackRef): void {
    removeManagedTree(this.path(ref));
  }
}

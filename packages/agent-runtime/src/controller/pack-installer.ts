import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import semver from 'semver';
import type { CatalogPack, PackRef } from '../types';
import type { EnvironmentCatalog } from './environment-catalog';
import type { ToolchainStore } from './toolchain-store';

const RUNNER_API_VERSION = '1.0.0';
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 16_384;
const MAX_DEPTH = 32;
const MAX_MANIFEST_BYTES = 64 * 1024;

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
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error('ENVIRONMENT_PACK_REF_INVALID');
  return value;
};

const safeArchivePath = (raw: string): string => {
  if (!raw || raw.includes('\0') || raw.includes('\\') || path.posix.isAbsolute(raw)) {
    throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '') return '.';
  if (normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
  }
  if (normalized.split('/').length > MAX_DEPTH) throw new Error('ENVIRONMENT_PACK_ARCHIVE_TOO_DEEP');
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
    if (stat.isSymbolicLink()) throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) visit(path.join(current, name));
      if (!isRoot) fs.chmodSync(current, 0o555);
      fsyncFile(current);
      return;
    }
    if (!stat.isFile()) throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
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

/** Catalog-bound installer. Sources are never accepted from ordinary HTTP/API input. */
export class PackInstaller {
  constructor(
    private readonly catalog: EnvironmentCatalog,
    private readonly store: ToolchainStore,
    private readonly cacheRoot: string,
  ) {
    fs.mkdirSync(path.join(cacheRoot, 'download'), { recursive: true });
  }

  installed(ref: PackRef): boolean {
    return this.store.installed(ref);
  }

  async uninstall(ref: PackRef): Promise<void> {
    const pack = this.catalog.pack(ref.familyId, ref.versionId);
    const expected = pack.contentDigestByArch[process.arch];
    if (!expected || expected !== ref.contentDigest) throw new Error('ENVIRONMENT_PACK_DIGEST_MISMATCH');
    this.store.remove(ref);
  }

  async ensure(refs: readonly PackRef[], commandId: string = randomUUID()): Promise<void> {
    const expanded = this.expandDependencies(refs);
    for (const ref of expanded) {
      const pack = this.catalog.pack(ref.familyId, ref.versionId);
      const expected = pack.contentDigestByArch[process.arch];
      if (!expected || expected !== ref.contentDigest || !/^sha256:[a-f0-9]{64}$/.test(expected)) {
        throw new Error('ENVIRONMENT_PACK_DIGEST_MISMATCH');
      }
      if (this.store.installed(ref)) continue;
      await this.installOne(pack, ref, commandId);
    }
  }

  private expandDependencies(refs: readonly PackRef[]): PackRef[] {
    const result: PackRef[] = [];
    const visiting = new Set<string>();
    const complete = new Set<string>();
    const visit = (ref: PackRef): void => {
      const key = `${ref.familyId}/${ref.versionId}/${ref.contentDigest}`;
      if (complete.has(key)) return;
      if (visiting.has(key)) throw new Error('ENVIRONMENT_PACK_DEPENDENCY_CYCLE');
      visiting.add(key);
      const pack = this.catalog.pack(ref.familyId, ref.versionId);
      const expected = pack.contentDigestByArch[process.arch];
      if (!expected || expected !== ref.contentDigest) throw new Error('ENVIRONMENT_PACK_DIGEST_MISMATCH');
      for (const dependency of pack.dependencies) {
        const child = this.catalog.pack(dependency.familyId, dependency.versionId);
        const digest = child.contentDigestByArch[process.arch];
        if (!digest) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
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
    if (downloadRef !== expectedRef) throw new Error('ENVIRONMENT_PACK_SOURCE_UNSUPPORTED');
    const source = this.catalog.catalogPath(
      'builtin-packs',
      safeSegment(pack.familyId),
      safeSegment(pack.versionId),
      `${safeSegment(architecture)}.tar`,
    );
    if (!fs.existsSync(source)) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
      throw new Error('ENVIRONMENT_PACK_SOURCE_INVALID');
    }
    return source;
  }

  private async cachedArchive(pack: CatalogPack, ref: PackRef, commandId: string): Promise<string> {
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
      throw new Error('ENVIRONMENT_PACK_SOURCE_INVALID');
    }
    const digest = await hashFile(temporary);
    if (digest !== ref.contentDigest) {
      fs.rmSync(temporary, { force: true });
      throw new Error('ENVIRONMENT_PACK_DIGEST_MISMATCH');
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
        if (entries > MAX_ENTRIES) throw new Error('ENVIRONMENT_PACK_ARCHIVE_TOO_MANY_FILES');
        const normalized = safeArchivePath(entry.path);
        if (normalized !== '.') {
          if (seen.has(normalized)) throw new Error('ENVIRONMENT_PACK_ARCHIVE_DUPLICATE_PATH');
          seen.add(normalized);
        }
        if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
        if (entry.linkpath) throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
        if (entry.type === 'File') {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SINGLE_FILE_BYTES) {
            throw new Error('ENVIRONMENT_PACK_ARCHIVE_FILE_TOO_LARGE');
          }
          expandedBytes += entry.size;
          if (expandedBytes > expandedLimit) throw new Error('ENVIRONMENT_PACK_ARCHIVE_TOO_LARGE');
        }
      },
    });
    if (!seen.has('pack.json')) throw new Error('ENVIRONMENT_PACK_MANIFEST_MISSING');
  }

  private verifyManifest(staging: string, pack: CatalogPack): void {
    const manifestPath = path.join(staging, 'pack.json');
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error('ENVIRONMENT_PACK_MANIFEST_INVALID');
    }
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackManifest;
    } catch {
      throw new Error('ENVIRONMENT_PACK_MANIFEST_INVALID');
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
      throw new Error('ENVIRONMENT_PACK_MANIFEST_INVALID');
    }
  }

  private async installOne(pack: CatalogPack, ref: PackRef, commandId: string): Promise<void> {
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
            throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
          }
          if (entry.linkpath) throw new Error('ENVIRONMENT_PACK_ARCHIVE_UNSAFE');
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

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import type {
  PackageVerifierPort,
  PluginStageSource,
  PublisherKeyInfo,
  StagedPluginPackage,
  VerifiedPluginFile,
  VerifiedPluginPackage,
} from '../../../modules/agent/host/package-verifier.port';
import type { AgentAppManifest, ValidatedManifest } from '../../../modules/agent/host/app.types';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_DEPTH = 32;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_FILE_LIST_BYTES = 1024 * 1024;
const CONTROL_FILES = new Set(['manifest.json', 'files.json', 'signature.ed25519']);
const SIGNATURE_DOMAIN = Buffer.from('NEXUS_AGENT_PLUGIN_V1\0', 'utf8');
const INSTALLED_PLUGIN_PARENT_MODE = 0o711;

interface SignedFileList {
  schemaVersion: 1;
  publisherKeyId: string;
  files: VerifiedPluginFile[];
}

const safeSegment = (value: string): string => {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error('PLUGIN_PACKAGE_REF_INVALID');
  return value;
};

const safeArchivePath = (raw: string, directory = false): string => {
  if (!raw || raw.includes('\0') || raw.includes('\\') || path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new Error('PLUGIN_ARCHIVE_UNSAFE');
  }
  let canonical = raw.replace(/^\.\//, '');
  if (directory && canonical.endsWith('/')) canonical = canonical.slice(0, -1);
  const normalized = path.posix.normalize(canonical);
  if (normalized === '.' || normalized === '') return '.';
  const segments = normalized.split('/');
  if (normalized === '..' || normalized.startsWith('../') || segments.some((segment) => segment === '..' || !segment)) {
    throw new Error('PLUGIN_ARCHIVE_UNSAFE');
  }
  if (segments.length > MAX_DEPTH) throw new Error('PLUGIN_ARCHIVE_TOO_DEEP');
  return normalized;
};

const verifierError = (error: unknown): Error => (error instanceof Error ? error : new Error('PLUGIN_PACKAGE_INVALID'));

const hashFile = async (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });

const fsyncPath = (target: string): void => {
  const descriptor = fs.openSync(target, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
};

const lockTree = (root: string): void => {
  const visit = (target: string, isRoot = false): void => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('PLUGIN_ARCHIVE_UNSAFE');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) visit(path.join(target, name));
      if (!isRoot) fs.chmodSync(target, 0o555);
      fsyncPath(target);
      return;
    }
    if (!stat.isFile()) throw new Error('PLUGIN_ARCHIVE_UNSAFE');
    fs.chmodSync(target, stat.mode & 0o111 ? 0o555 : 0o444);
    fsyncPath(target);
  };
  visit(root, true);
};

const unlockTree = (root: string): void => {
  const visit = (target: string): void => {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
      fs.chmodSync(target, 0o700);
      for (const name of fs.readdirSync(target)) visit(path.join(target, name));
      return;
    }
    if (stat.isFile()) {
      fs.chmodSync(target, 0o600);
      return;
    }
    throw new Error('PLUGIN_INSTALL_CORRUPT');
  };
  visit(root);
};

const parseFileList = (raw: Buffer): SignedFileList => {
  if (raw.byteLength > MAX_FILE_LIST_BYTES) throw new Error('PLUGIN_FILE_LIST_TOO_LARGE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new Error('PLUGIN_FILE_LIST_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PLUGIN_FILE_LIST_INVALID');
  const input = parsed as Record<string, unknown>;
  if (input.schemaVersion !== 1 || typeof input.publisherKeyId !== 'string' || !input.publisherKeyId) {
    throw new Error('PLUGIN_FILE_LIST_INVALID');
  }
  if (!Array.isArray(input.files) || input.files.length > MAX_ENTRIES) throw new Error('PLUGIN_FILE_LIST_INVALID');
  const files: VerifiedPluginFile[] = [];
  const seen = new Set<string>();
  for (const rawFile of input.files) {
    if (!rawFile || typeof rawFile !== 'object' || Array.isArray(rawFile)) throw new Error('PLUGIN_FILE_LIST_INVALID');
    const file = rawFile as Record<string, unknown>;
    if (Object.keys(file).some((key) => !['path', 'sha256', 'sizeBytes'].includes(key))) {
      throw new Error('PLUGIN_FILE_LIST_INVALID');
    }
    if (
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      (file.sizeBytes as number) < 0 ||
      (file.sizeBytes as number) > MAX_SINGLE_FILE_BYTES
    ) {
      throw new Error('PLUGIN_FILE_LIST_INVALID');
    }
    const normalized = safeArchivePath(file.path);
    if (normalized === '.' || CONTROL_FILES.has(normalized) || seen.has(normalized))
      throw new Error('PLUGIN_FILE_LIST_INVALID');
    seen.add(normalized);
    files.push({ path: normalized, sha256: file.sha256, sizeBytes: file.sizeBytes as number });
  }
  return { schemaVersion: 1, publisherKeyId: input.publisherKeyId, files };
};

export class TarPackageVerifierAdapter implements PackageVerifierPort {
  private readonly pluginsRoot: string;
  private readonly unverifiedStagingRoot: string;

  constructor(dataDirectory: string) {
    const agentRoot = path.join(dataDirectory, 'agent');
    this.pluginsRoot = path.join(agentRoot, 'plugins');
    this.unverifiedStagingRoot = path.join(this.pluginsRoot, '.staging');
    fs.mkdirSync(this.pluginsRoot, { recursive: true, mode: INSTALLED_PLUGIN_PARENT_MODE });
    // Installed immutable versions are read by an external/standalone Runner through a read-only mount.
    // Shared parents are traverse-only for non-owners; private siblings and unverified staging keep 0700.
    fs.chmodSync(agentRoot, INSTALLED_PLUGIN_PARENT_MODE);
    fs.chmodSync(this.pluginsRoot, INSTALLED_PLUGIN_PARENT_MODE);
    fs.mkdirSync(this.unverifiedStagingRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.unverifiedStagingRoot, 0o700);
  }

  async normalizePublisherKey(publicKeyPem: string): Promise<PublisherKeyInfo> {
    if (Buffer.byteLength(publicKeyPem, 'utf8') > 16 * 1024) throw new Error('PUBLISHER_KEY_INVALID');
    let key;
    try {
      key = createPublicKey(publicKeyPem);
    } catch {
      throw new Error('PUBLISHER_KEY_INVALID');
    }
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('PUBLISHER_KEY_INVALID');
    const der = key.export({ type: 'spki', format: 'der' });
    const keyId = `ed25519:${createHash('sha256').update(der).digest('hex')}`;
    return { keyId, publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString() };
  }

  async stage(input: PluginStageSource): Promise<StagedPluginPackage> {
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_ARCHIVE_BYTES) {
      throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
    }
    const stageId = safeSegment(input.stageId);
    const stageRoot = this.unverifiedStageDirectory(stageId);
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.mkdirSync(stageRoot, { recursive: true, mode: 0o700 });
    const finalPath = path.join(stageRoot, 'package.tar');
    const temporaryPath = `${finalPath}.part`;
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of input.source) {
        bytes += chunk.byteLength;
        if (bytes > MAX_ARCHIVE_BYTES || bytes > input.sizeBytes) throw new Error('PLUGIN_PACKAGE_TOO_LARGE');
        hash.update(chunk);
        await handle.write(Buffer.from(chunk));
      }
      if (bytes !== input.sizeBytes) throw new Error('PLUGIN_PACKAGE_SIZE_MISMATCH');
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      fs.rmSync(stageRoot, { recursive: true, force: true });
      throw error;
    }
    await handle.close();
    fs.renameSync(temporaryPath, finalPath);
    fsyncPath(stageRoot);
    fsyncPath(this.unverifiedStagingRoot);
    return { stageId, packageHash: hash.digest('hex'), sizeBytes: bytes };
  }

  async verify(
    stageId: string,
    appIdHint: string | null,
    resolvePublisherKey: (keyId: string) => Promise<string | null>,
    validateManifest: (raw: AgentAppManifest) => ValidatedManifest,
  ): Promise<VerifiedPluginPackage> {
    const safeStageId = safeSegment(stageId);
    const stageRoot = this.locateStageDirectory(safeStageId, appIdHint);
    const archive = path.join(stageRoot, 'package.tar');
    if (!fs.existsSync(archive)) throw new Error('PLUGIN_STAGE_NOT_FOUND');
    const archiveStat = fs.lstatSync(archive);
    if (
      !archiveStat.isFile() ||
      archiveStat.isSymbolicLink() ||
      archiveStat.size < 1 ||
      archiveStat.size > MAX_ARCHIVE_BYTES
    ) {
      throw new Error('PLUGIN_PACKAGE_INVALID');
    }
    const packageHash = await hashFile(archive);
    const unpacked = path.join(stageRoot, 'unpacked');
    fs.rmSync(unpacked, { force: true, recursive: true });
    fs.mkdirSync(unpacked, { recursive: true, mode: 0o700 });

    const archiveFiles = new Set<string>();
    let entries = 0;
    let expandedBytes = 0;
    let archiveValidationError: Error | null = null;
    try {
      await tar.t({
        file: archive,
        strict: true,
        maxDecompressionRatio: 100,
        onentry: (entry) => {
          if (archiveValidationError) return;
          try {
            entries += 1;
            if (entries > MAX_ENTRIES) throw new Error('PLUGIN_ARCHIVE_TOO_MANY_FILES');
            if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('PLUGIN_ARCHIVE_UNSAFE');
            const normalized = safeArchivePath(entry.path, entry.type === 'Directory');
            if (normalized !== '.' && archiveFiles.has(normalized)) throw new Error('PLUGIN_ARCHIVE_DUPLICATE_PATH');
            if (normalized !== '.') archiveFiles.add(normalized);
            if (entry.linkpath) throw new Error('PLUGIN_ARCHIVE_UNSAFE');
            if (entry.type === 'File') {
              if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SINGLE_FILE_BYTES) {
                throw new Error('PLUGIN_ARCHIVE_FILE_TOO_LARGE');
              }
              expandedBytes += entry.size;
              if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('PLUGIN_ARCHIVE_TOO_LARGE');
            }
          } catch (error) {
            archiveValidationError = verifierError(error);
          }
        },
      });
      if (archiveValidationError) throw archiveValidationError;
      for (const required of CONTROL_FILES) {
        if (!archiveFiles.has(required)) throw new Error('PLUGIN_CONTROL_FILE_MISSING');
      }
      await tar.x({ file: archive, cwd: unpacked, strict: true, preservePaths: false, unlink: true });

      const manifestPath = path.join(unpacked, 'manifest.json');
      const fileListPath = path.join(unpacked, 'files.json');
      const signaturePath = path.join(unpacked, 'signature.ed25519');
      const manifestStat = fs.lstatSync(manifestPath);
      const listStat = fs.lstatSync(fileListPath);
      const signatureStat = fs.lstatSync(signaturePath);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > MAX_MANIFEST_BYTES) {
        throw new Error('PLUGIN_MANIFEST_INVALID');
      }
      if (!listStat.isFile() || listStat.isSymbolicLink() || listStat.size > MAX_FILE_LIST_BYTES) {
        throw new Error('PLUGIN_FILE_LIST_INVALID');
      }
      if (!signatureStat.isFile() || signatureStat.isSymbolicLink() || signatureStat.size !== 64) {
        throw new Error('PLUGIN_SIGNATURE_INVALID');
      }
      const manifestBytes = fs.readFileSync(manifestPath);
      const fileListBytes = fs.readFileSync(fileListPath);
      const signature = fs.readFileSync(signaturePath);
      const fileList = parseFileList(fileListBytes);
      const publicKeyPem = await resolvePublisherKey(fileList.publisherKeyId);
      if (!publicKeyPem) throw new Error('PLUGIN_PUBLISHER_UNTRUSTED');
      const keyInfo = await this.normalizePublisherKey(publicKeyPem);
      if (fileList.publisherKeyId !== keyInfo.keyId) throw new Error('PLUGIN_PUBLISHER_KEY_MISMATCH');
      const signed = Buffer.concat([SIGNATURE_DOMAIN, manifestBytes, Buffer.from([0]), fileListBytes]);
      if (!verifySignature(null, signed, keyInfo.publicKeyPem, signature)) throw new Error('PLUGIN_SIGNATURE_INVALID');

      let rawManifest: AgentAppManifest;
      try {
        rawManifest = JSON.parse(manifestBytes.toString('utf8')) as AgentAppManifest;
      } catch {
        throw new Error('PLUGIN_MANIFEST_INVALID');
      }
      const manifest = validateManifest(rawManifest);
      if (appIdHint !== null && manifest.id !== appIdHint) throw new Error('PLUGIN_APP_ID_MISMATCH');
      const listed = new Set(fileList.files.map((file) => file.path));
      for (const archived of archiveFiles) {
        if (CONTROL_FILES.has(archived) || archived === '.') continue;
        const local = path.join(unpacked, ...archived.split('/'));
        const stat = fs.lstatSync(local);
        if (stat.isDirectory()) continue;
        if (!listed.has(archived)) throw new Error('PLUGIN_UNLISTED_FILE');
      }
      for (const file of fileList.files) {
        if (!archiveFiles.has(file.path)) throw new Error('PLUGIN_LISTED_FILE_MISSING');
        const local = path.join(unpacked, ...file.path.split('/'));
        const stat = fs.lstatSync(local);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.sizeBytes) {
          throw new Error('PLUGIN_FILE_MISMATCH');
        }
        if ((await hashFile(local)) !== file.sha256) throw new Error('PLUGIN_FILE_HASH_MISMATCH');
      }
      const frontendEntry = manifest.targets?.frontend?.entry ?? null;
      const backendEntry = manifest.targets?.backend?.entry ?? null;
      const runnerEntry = manifest.targets?.runner?.entry ?? null;
      const targetEntries = [frontendEntry, backendEntry, runnerEntry].filter((entry): entry is string =>
        Boolean(entry),
      );
      if (targetEntries.some((entry) => !listed.has(entry))) throw new Error('PLUGIN_TARGET_ENTRY_MISSING');
      if (frontendEntry && (!/^frontend\/[A-Za-z0-9_./-]+$/.test(frontendEntry) || frontendEntry.includes('..'))) {
        throw new Error('PLUGIN_FRONTEND_ENTRY_INVALID');
      }
      if (backendEntry && (!/^backend\/[A-Za-z0-9_./-]+$/.test(backendEntry) || backendEntry.includes('..'))) {
        throw new Error('PLUGIN_BACKEND_ENTRY_INVALID');
      }
      if (runnerEntry && (!/^runner\/[A-Za-z0-9_./-]+$/.test(runnerEntry) || runnerEntry.includes('..'))) {
        throw new Error('PLUGIN_RUNNER_ENTRY_INVALID');
      }
      const skillResourcePaths = fileList.files
        .map((file) => file.path)
        .filter((filePath) => filePath.startsWith('skills/'));
      if (skillResourcePaths.some((filePath) => !/^skills\/[A-Za-z0-9_.-]+\/SKILL\.md$/.test(filePath))) {
        throw new Error('PLUGIN_SKILL_LAYOUT_INVALID');
      }
      const skillFiles = skillResourcePaths.slice().sort();
      if (skillFiles.length > 64) throw new Error('PLUGIN_TOO_MANY_SKILLS');
      return {
        stageId: safeStageId,
        packageHash,
        publisherKeyId: keyInfo.keyId,
        manifest,
        files: fileList.files,
        frontendEntry,
        backendEntry,
        runnerEntry,
        skillFiles,
      };
    } catch (error) {
      fs.rmSync(unpacked, { force: true, recursive: true });
      throw error;
    }
  }

  async adoptStage(stageId: string, appId: string): Promise<void> {
    const safeStageId = safeSegment(stageId);
    const safeAppId = safeSegment(appId);
    const source = this.unverifiedStageDirectory(safeStageId);
    const targetRoot = this.pluginStagingRoot(safeAppId);
    const target = path.join(targetRoot, safeStageId);
    if (fs.existsSync(target)) {
      if (fs.existsSync(source)) throw new Error('PLUGIN_STAGE_STORAGE_CONFLICT');
      return;
    }
    if (!fs.existsSync(source)) {
      const located = this.locateStageDirectory(safeStageId, safeAppId);
      if (located === target) return;
      throw new Error('PLUGIN_STAGE_NOT_FOUND');
    }
    fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
    fs.renameSync(source, target);
    fsyncPath(targetRoot);
  }

  async install(stageId: string, verified: VerifiedPluginPackage): Promise<void> {
    if (stageId !== verified.stageId) throw new Error('PLUGIN_STAGE_MISMATCH');
    await this.adoptStage(stageId, verified.manifest.id);
    const safeAppId = safeSegment(verified.manifest.id);
    const safeVersion = safeSegment(verified.manifest.version);
    const stageRoot = this.locateStageDirectory(safeSegment(stageId), safeAppId);
    const unpacked = path.join(stageRoot, 'unpacked');
    if (!fs.existsSync(unpacked)) throw new Error('PLUGIN_STAGE_NOT_VERIFIED');
    const appRoot = path.join(this.pluginsRoot, safeAppId);
    const versionsRoot = path.join(appRoot, 'versions');
    const target = path.join(versionsRoot, safeVersion);
    fs.mkdirSync(appRoot, { recursive: true, mode: INSTALLED_PLUGIN_PARENT_MODE });
    fs.chmodSync(appRoot, INSTALLED_PLUGIN_PARENT_MODE);
    fs.mkdirSync(versionsRoot, { recursive: true, mode: INSTALLED_PLUGIN_PARENT_MODE });
    fs.chmodSync(versionsRoot, INSTALLED_PLUGIN_PARENT_MODE);
    if (fs.existsSync(target)) {
      const marker = path.join(target, '.nexus-package-hash');
      if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === verified.packageHash) return;
      throw new Error('PLUGIN_VERSION_IMMUTABLE');
    }
    fs.writeFileSync(path.join(unpacked, '.nexus-package-hash'), `${verified.packageHash}\n`, { mode: 0o600 });
    fsyncPath(path.join(unpacked, '.nexus-package-hash'));
    const incoming = path.join(versionsRoot, `.incoming-${safeSegment(stageId)}`);
    if (fs.existsSync(incoming)) {
      unlockTree(incoming);
      fs.rmSync(incoming, { recursive: true, force: true });
    }
    fs.renameSync(unpacked, incoming);
    lockTree(incoming);
    fs.chmodSync(incoming, 0o555);
    fs.renameSync(incoming, target);
    fsyncPath(versionsRoot);
  }

  async removeInstalled(appId: string, version: string): Promise<void> {
    const safeAppId = safeSegment(appId);
    const safeVersion = safeSegment(version);
    const target = path.join(this.pluginsRoot, safeAppId, 'versions', safeVersion);
    if (fs.existsSync(target)) {
      unlockTree(target);
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  async discardStage(stageId: string, appId?: string | null): Promise<void> {
    const safeStageId = safeSegment(stageId);
    const candidates = [this.unverifiedStageDirectory(safeStageId)];
    if (appId) candidates.push(path.join(this.pluginStagingRoot(safeSegment(appId)), safeStageId));
    else candidates.push(...this.findScopedStageDirectories(safeStageId));
    for (const target of new Set(candidates)) fs.rmSync(target, { recursive: true, force: true });
  }

  async reconcileStages(activeStages: readonly { stageId: string; appId: string | null }[]): Promise<void> {
    if (activeStages.length > 100_000) throw new Error('PLUGIN_STAGE_RECONCILE_TOO_LARGE');
    const active = new Map(
      activeStages.map((stage) => [safeSegment(stage.stageId), stage.appId && safeSegment(stage.appId)]),
    );
    for (const [stageId, appId] of active) {
      if (appId) await this.adoptStage(stageId, appId).catch(() => undefined);
    }
    for (const entry of fs.readdirSync(this.unverifiedStagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || active.has(entry.name)) continue;
      fs.rmSync(path.join(this.unverifiedStagingRoot, entry.name), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.staging' || !/^[A-Za-z0-9_.-]{1,128}$/.test(entry.name)) continue;
      const stagingRoot = this.pluginStagingRoot(entry.name);
      if (!fs.existsSync(stagingRoot)) continue;
      for (const staged of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
        if (!staged.isDirectory()) continue;
        const expectedAppId = active.get(staged.name);
        if (expectedAppId === entry.name) continue;
        if (expectedAppId === null) continue;
        fs.rmSync(path.join(stagingRoot, staged.name), { recursive: true, force: true });
      }
    }
  }

  private locateStageDirectory(stageId: string, appIdHint: string | null): string {
    if (appIdHint) {
      const scoped = path.join(this.pluginStagingRoot(safeSegment(appIdHint)), safeSegment(stageId));
      if (fs.existsSync(scoped)) return scoped;
    }
    const unverified = this.unverifiedStageDirectory(stageId);
    if (fs.existsSync(unverified)) return unverified;
    const scoped = this.findScopedStageDirectories(stageId);
    if (scoped.length === 1) return scoped[0]!;
    if (scoped.length > 1) throw new Error('PLUGIN_STAGE_STORAGE_CONFLICT');
    throw new Error('PLUGIN_STAGE_NOT_FOUND');
  }

  private findScopedStageDirectories(stageId: string): string[] {
    const safeStageId = safeSegment(stageId);
    const matches: string[] = [];
    for (const entry of fs.readdirSync(this.pluginsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.staging' || !/^[A-Za-z0-9_.-]{1,128}$/.test(entry.name)) continue;
      const candidate = path.join(this.pluginsRoot, entry.name, 'staging', safeStageId);
      if (fs.existsSync(candidate)) matches.push(candidate);
      if (matches.length > 1) break;
    }
    return matches;
  }

  private pluginStagingRoot(appId: string): string {
    return path.join(this.pluginsRoot, safeSegment(appId), 'staging');
  }

  private unverifiedStageDirectory(stageId: string): string {
    return path.join(this.unverifiedStagingRoot, safeSegment(stageId));
  }
}

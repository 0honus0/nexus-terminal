import fs from 'node:fs';
import path from 'node:path';

export type WorkspacePermission = 'read' | 'write' | 'list' | 'delete';

export interface WorkspaceGrant {
  targetPluginId: string;
  principalPluginId: string;
  path: string;
  permissions: WorkspacePermission[];
}

export interface WorkspaceAccessTarget {
  workspaceId: string;
  generation: number;
  callerPluginId: string;
  targetPluginId: string;
  path: string;
}

interface WorkspaceAclDocument {
  schemaVersion: 1;
  grants: WorkspaceGrant[];
}

const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_PLUGIN_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_HOST_WORKSPACE_TRANSFER_BYTES = 256 * 1024 * 1024;

export interface WorkspaceReadHandle {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

const explicitPluginId = (value: string): string => {
  if (!SAFE_ID.test(value)) throw new Error('WORKSPACE_PLUGIN_ID_INVALID');
  return value;
};

const logicalPath = (value: string): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0'))
    throw new Error('WORKSPACE_PATH_INVALID');
  const segments = value.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('WORKSPACE_PATH_INVALID');
  const normalized = `/${segments.join('/')}`;
  if (normalized.length > 4096) throw new Error('WORKSPACE_PATH_INVALID');
  return normalized;
};

const grantPath = (value: string): { path: string; recursive: boolean } => {
  const recursive = value.endsWith('/**');
  return { path: logicalPath(recursive ? value.slice(0, -3) || '/' : value), recursive };
};

const pathMatches = (rule: string, candidate: string): boolean => {
  const parsed = grantPath(rule);
  if (!parsed.recursive) return parsed.path === candidate;
  return parsed.path === '/' || candidate === parsed.path || candidate.startsWith(`${parsed.path}/`);
};

export class WorkspaceBroker {
  constructor(private readonly runtimeRoot: string) {}

  ensurePluginWorkspace(workspaceId: string, generation: number, targetPluginId: string): string {
    const root = this.workspaceRoot(workspaceId, generation, targetPluginId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
  }

  replaceTargetGrants(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    grants: readonly Omit<WorkspaceGrant, 'targetPluginId'>[],
  ): void {
    const target = explicitPluginId(targetPluginId);
    if (!Array.isArray(grants) || grants.length > 256) throw new Error('WORKSPACE_ACL_INVALID');
    const normalized = grants.map((grant) => this.validateGrant({ ...grant, targetPluginId: target }));
    const document = this.readAcl(workspaceId, generation);
    document.grants = [...document.grants.filter((grant) => grant.targetPluginId !== target), ...normalized];
    this.writeAcl(workspaceId, generation, document);
  }

  grantsForTarget(workspaceId: string, generation: number, targetPluginId: string): WorkspaceGrant[] {
    const target = explicitPluginId(targetPluginId);
    return this.readAcl(workspaceId, generation)
      .grants.filter((grant) => grant.targetPluginId === target)
      .map((grant) => ({ ...grant, permissions: [...grant.permissions] }));
  }

  read(target: WorkspaceAccessTarget): Buffer {
    const file = this.authorizedPath(target, 'read');
    const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || stat.size > MAX_PLUGIN_FILE_BYTES) throw new Error('WORKSPACE_FILE_INVALID');
      const value = fs.readFileSync(handle);
      if (value.byteLength > MAX_PLUGIN_FILE_BYTES) throw new Error('WORKSPACE_FILE_INVALID');
      return value;
    } finally {
      fs.closeSync(handle);
    }
  }

  write(target: WorkspaceAccessTarget, value: Uint8Array): void {
    if (!(value instanceof Uint8Array) || value.byteLength > MAX_PLUGIN_FILE_BYTES)
      throw new Error('WORKSPACE_FILE_INVALID');
    const file = this.authorizedPath(target, 'write', true);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.assertNoSymlink(this.workspaceRoot(target.workspaceId, target.generation, target.targetPluginId), file, true);
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async openRead(target: WorkspaceAccessTarget): Promise<WorkspaceReadHandle> {
    const file = this.authorizedPath(target, 'read');
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => undefined);
    };
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('WORKSPACE_FILE_INVALID');
      if (stat.size > MAX_HOST_WORKSPACE_TRANSFER_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
      const source = (async function* (): AsyncIterable<Uint8Array> {
        try {
          const stream = handle.createReadStream({ autoClose: false });
          for await (const chunk of stream) yield Buffer.from(chunk);
        } finally {
          await close();
        }
      })();
      return { sizeBytes: stat.size, source, close };
    } catch (error) {
      await close();
      throw error;
    }
  }

  async writeStream(
    target: WorkspaceAccessTarget,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new Error('WORKSPACE_FILE_INVALID');
    if (expectedBytes > MAX_HOST_WORKSPACE_TRANSFER_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
    const file = this.authorizedPath(target, 'write', true);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.assertNoSymlink(
      this.workspaceRoot(target.workspaceId, target.generation, target.targetPluginId),
      path.dirname(file),
      true,
    );
    const temporary = `${file}.stream-${process.pid}-${Date.now()}`;
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    let written = 0;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => undefined);
    };
    try {
      for await (const rawChunk of source) {
        const chunk = Buffer.from(rawChunk);
        written += chunk.byteLength;
        if (written > MAX_HOST_WORKSPACE_TRANSFER_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
        if (written > expectedBytes) throw new Error('WORKSPACE_SIZE_MISMATCH');
        let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await handle.write(chunk, offset, chunk.byteLength - offset, null);
          if (result.bytesWritten <= 0) throw new Error('WORKSPACE_WRITE_FAILED');
          offset += result.bytesWritten;
        }
      }
      if (written !== expectedBytes) throw new Error('WORKSPACE_SIZE_MISMATCH');
      await handle.sync();
      await close();
      fs.renameSync(temporary, file);
    } catch (error) {
      await close();
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  mkdir(target: WorkspaceAccessTarget): void {
    const directory = this.authorizedPath(target, 'write', true);
    this.assertNoSymlink(
      this.workspaceRoot(target.workspaceId, target.generation, target.targetPluginId),
      path.dirname(directory),
      true,
    );
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  rename(target: WorkspaceAccessTarget, destinationPath: string): void {
    const source = this.authorizedPath(target, 'delete');
    const destinationTarget = { ...target, path: destinationPath };
    const destination = this.authorizedPath(destinationTarget, 'write', true);
    const root = this.workspaceRoot(target.workspaceId, target.generation, target.targetPluginId);
    this.assertNoSymlink(root, source);
    this.assertNoSymlink(root, path.dirname(destination), true);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) throw new Error('WORKSPACE_DESTINATION_EXISTS');
    fs.renameSync(source, destination);
  }

  list(target: WorkspaceAccessTarget): string[] {
    const directory = this.authorizedPath(target, 'list');
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }

  remove(target: WorkspaceAccessTarget): void {
    const file = this.authorizedPath(target, 'delete');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    if (stat.isDirectory()) fs.rmSync(file, { recursive: true, force: false });
    else fs.unlinkSync(file);
  }

  stat(target: WorkspaceAccessTarget) {
    const file = this.authorizedPath(target, 'read');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    return { type: stat.isDirectory() ? 'directory' : 'file', sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs };
  }

  private authorizedPath(target: WorkspaceAccessTarget, permission: WorkspacePermission, allowMissing = false): string {
    const caller = explicitPluginId(target.callerPluginId);
    const owner = explicitPluginId(target.targetPluginId);
    const candidate = logicalPath(target.path);
    if (caller !== owner) {
      const allowed = this.grantsForTarget(target.workspaceId, target.generation, owner).some(
        (grant) =>
          grant.principalPluginId === caller &&
          grant.permissions.includes(permission) &&
          pathMatches(grant.path, candidate),
      );
      if (!allowed) throw new Error('WORKSPACE_ACCESS_DENIED');
    }
    const root = this.ensurePluginWorkspace(target.workspaceId, target.generation, owner);
    const resolved = path.join(root, ...candidate.split('/').filter(Boolean));
    this.assertNoSymlink(root, resolved, allowMissing);
    return resolved;
  }

  private validateGrant(grant: WorkspaceGrant): WorkspaceGrant {
    const targetPluginId = explicitPluginId(grant.targetPluginId);
    const principalPluginId = explicitPluginId(grant.principalPluginId);
    const parsed = grantPath(grant.path);
    const permissions = [...new Set(grant.permissions)] as WorkspacePermission[];
    if (
      !permissions.length ||
      permissions.some((permission) => !['read', 'write', 'list', 'delete'].includes(permission))
    ) {
      throw new Error('WORKSPACE_ACL_INVALID');
    }
    return {
      targetPluginId,
      principalPluginId,
      path: parsed.recursive ? (parsed.path === '/' ? '/**' : `${parsed.path}/**`) : parsed.path,
      permissions,
    };
  }

  private assertNoSymlink(root: string, target: string, allowMissing = false): void {
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) {
        if (allowMissing) continue;
        throw new Error('WORKSPACE_NOT_FOUND');
      }
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    }
  }

  private workspaceRoot(workspaceId: string, generation: number, targetPluginId: string): string {
    this.requireWorkspaceGeneration(workspaceId, generation);
    return path.join(this.workspaceBase(workspaceId), 'plugins', explicitPluginId(targetPluginId), 'workspace');
  }

  private requireWorkspaceGeneration(workspaceId: string, generation: number): void {
    if (!SAFE_ID.test(workspaceId) || !Number.isSafeInteger(generation) || generation < 1)
      throw new Error('WORKSPACE_ID_INVALID');
    const root = path.join(this.runtimeRoot, 'generations', workspaceId, String(generation));
    if (!fs.existsSync(root)) throw new Error('WORKSPACE_NOT_FOUND');
  }

  private workspaceBase(workspaceId: string): string {
    if (!SAFE_ID.test(workspaceId)) throw new Error('WORKSPACE_ID_INVALID');
    return path.join(this.runtimeRoot, 'workspaces', workspaceId);
  }

  private aclFile(workspaceId: string, generation: number): string {
    this.requireWorkspaceGeneration(workspaceId, generation);
    return path.join(this.workspaceBase(workspaceId), '.control', 'workspace-acl.json');
  }

  private readAcl(workspaceId: string, generation: number): WorkspaceAclDocument {
    const file = this.aclFile(workspaceId, generation);
    if (!fs.existsSync(file)) return { schemaVersion: 1, grants: [] };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as WorkspaceAclDocument;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.grants))
      throw new Error('WORKSPACE_ACL_INVALID');
    return { schemaVersion: 1, grants: parsed.grants.map((grant) => this.validateGrant(grant)) };
  }

  private writeAcl(workspaceId: string, generation: number, value: WorkspaceAclDocument): void {
    const file = this.aclFile(workspaceId, generation);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}

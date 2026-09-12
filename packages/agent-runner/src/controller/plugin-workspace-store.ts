import fs from 'node:fs';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_PLUGIN_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_HOST_WORKSPACE_TRANSFER_BYTES = 256 * 1024 * 1024;

export interface WorkspaceReadHandle {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

const logicalPath = (value: string): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }
  const segments = value.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('WORKSPACE_PATH_INVALID');
  const normalized = `/${segments.join('/')}`;
  if (normalized.length > 4096) throw new Error('WORKSPACE_PATH_INVALID');
  return normalized;
};

/** Plugin 自己逻辑工作目录的文件 API。它保证路径不会误写出目录，但不是 native Plugin 的安全沙箱。 */
export class PluginWorkspaceFiles {
  private readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root) || root.includes('\0')) throw new Error('WORKSPACE_PATH_INVALID');
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  read(logical: string): Buffer {
    const file = this.resolve(logical);
    const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || stat.size > MAX_PLUGIN_FILE_BYTES) throw new Error('WORKSPACE_FILE_INVALID');
      return fs.readFileSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  }

  write(logical: string, value: Uint8Array): void {
    if (!(value instanceof Uint8Array) || value.byteLength > MAX_PLUGIN_FILE_BYTES) {
      throw new Error('WORKSPACE_FILE_INVALID');
    }
    const file = this.resolve(logical, true);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.assertNoSymlink(file, true);
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  async openRead(logical: string): Promise<WorkspaceReadHandle> {
    const file = this.resolve(logical);
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

  async writeStream(logical: string, source: AsyncIterable<Uint8Array>, expectedBytes: number): Promise<void> {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new Error('WORKSPACE_FILE_INVALID');
    if (expectedBytes > MAX_HOST_WORKSPACE_TRANSFER_BYTES) throw new Error('WORKSPACE_FILE_TOO_LARGE');
    const file = this.resolve(logical, true);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.assertNoSymlink(path.dirname(file), true);
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

  list(logical: string): string[] {
    return fs
      .readdirSync(this.resolve(logical), { withFileTypes: true })
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  }

  stat(logical: string) {
    const stat = fs.lstatSync(this.resolve(logical));
    if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    return {
      type: stat.isDirectory() ? ('directory' as const) : ('file' as const),
      sizeBytes: stat.size,
      modifiedAtMs: stat.mtimeMs,
    };
  }

  mkdir(logical: string): void {
    const directory = this.resolve(logical, true);
    this.assertNoSymlink(path.dirname(directory), true);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  rename(logical: string, destinationLogical: string): void {
    const source = this.resolve(logical);
    const destination = this.resolve(destinationLogical, true);
    this.assertNoSymlink(source);
    this.assertNoSymlink(path.dirname(destination), true);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) throw new Error('WORKSPACE_DESTINATION_EXISTS');
    fs.renameSync(source, destination);
  }

  remove(logical: string): void {
    const file = this.resolve(logical);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    if (stat.isDirectory()) fs.rmSync(file, { recursive: true, force: false });
    else fs.unlinkSync(file);
  }

  private resolve(logical: string, allowMissing = false): string {
    const candidate = logicalPath(logical);
    const resolved = path.join(this.root, ...candidate.split('/').filter(Boolean));
    this.assertNoSymlink(resolved, allowMissing);
    return resolved;
  }

  private assertNoSymlink(target: string, allowMissing = false): void {
    const relative = path.relative(this.root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    let current = this.root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) {
        if (allowMissing) continue;
        throw new Error('WORKSPACE_NOT_FOUND');
      }
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('WORKSPACE_PATH_FORBIDDEN');
    }
  }
}

/** Host 用它定位 `<workspace>/<plugin>/workspace`，Artifact exchange 与 Plugin worker 共用同一路径。 */
export class PluginWorkspaceStore {
  constructor(private readonly runtimeRoot: string) {}

  ensure(workspaceId: string, generation: number, pluginId: string): string {
    if (!SAFE_ID.test(workspaceId) || !SAFE_ID.test(pluginId) || !Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('WORKSPACE_ID_INVALID');
    }
    const generationRoot = path.join(this.runtimeRoot, 'generations', workspaceId, String(generation));
    if (!fs.existsSync(generationRoot)) throw new Error('WORKSPACE_NOT_FOUND');
    const root = path.join(this.runtimeRoot, 'workspaces', workspaceId, 'plugins', pluginId, 'workspace');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
  }

  files(workspaceId: string, generation: number, pluginId: string): PluginWorkspaceFiles {
    return new PluginWorkspaceFiles(this.ensure(workspaceId, generation, pluginId));
  }
}

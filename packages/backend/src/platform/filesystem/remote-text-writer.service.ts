import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as iconv from 'iconv-lite';
import type { RemoteFileSystem } from './remote-filesystem';
import type { RemoteFileEntry } from './file-entry';
import { toRemoteFileEntry } from './file-entry';

const normalizeEncoding = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export class RemoteTextWriterService {
  async write(
    filesystem: RemoteFileSystem,
    remotePath: string,
    content: string,
    encoding = 'utf-8',
  ): Promise<RemoteFileEntry | null> {
    const normalizedEncoding = this.resolveRequestedEncoding(encoding);
    const original = await filesystem.metadata(remotePath).catch(() => null);
    const temporaryPath = path.posix.join(path.posix.dirname(remotePath), `.nexus-save-${randomUUID()}.part`);
    const stream = await filesystem.openWrite(temporaryPath, {
      flags: 'wx',
      ...(original ? { mode: original.mode } : {}),
    });
    try {
      stream.end(this.encodeContent(content, normalizedEncoding));
      await finished(stream);
      await filesystem.replaceFile(temporaryPath, remotePath);
    } catch (error) {
      stream.destroy();
      await finished(stream).catch(() => undefined);
      await filesystem.removeFile(temporaryPath, { ignoreMissing: true });
      throw error;
    }
    const metadata = await filesystem.metadata(remotePath).catch(() => null);
    return metadata ? toRemoteFileEntry(remotePath, metadata) : null;
  }

  async create(
    filesystem: RemoteFileSystem,
    remotePath: string,
    content = '',
    encoding = 'utf-8',
  ): Promise<RemoteFileEntry | null> {
    const normalizedEncoding = this.resolveRequestedEncoding(encoding);
    const stream = await filesystem.openWrite(remotePath, { flags: 'wx' });
    stream.end(this.encodeContent(content, normalizedEncoding));
    await finished(stream);
    const metadata = await filesystem.metadata(remotePath).catch(() => null);
    return metadata ? toRemoteFileEntry(remotePath, metadata) : null;
  }

  private resolveRequestedEncoding(value: string): string {
    const normalized = normalizeEncoding(value);
    return iconv.encodingExists(normalized) ? normalized : 'utf-8';
  }

  private encodeContent(content: string, encoding: string): Buffer {
    const contentWithoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
    const encoded = iconv.encode(contentWithoutBom, encoding);
    if (encoding === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]);
    if (encoding === 'utf16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), encoded]);
    return encoded;
  }
}

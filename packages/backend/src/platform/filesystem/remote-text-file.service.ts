import { finished } from 'node:stream/promises';
import * as iconv from 'iconv-lite';
import * as jschardet from 'jschardet';
import type { RemoteFileSystem } from './remote-filesystem';
import type { RemoteFileEntry } from './file-entry';
import { toRemoteFileEntry } from './file-entry';

export interface RemoteTextFileReadResult {
  rawContentBase64: string;
  encodingUsed: string;
}

const normalizeEncoding = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export class RemoteTextFileService {
  async read(
    filesystem: RemoteFileSystem,
    remotePath: string,
    requestedEncoding?: string,
  ): Promise<RemoteTextFileReadResult> {
    const stream = await filesystem.openRead(remotePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    const encodingUsed = requestedEncoding
      ? this.resolveRequestedEncoding(requestedEncoding)
      : this.detectEncoding(data);
    iconv.decode(data, encodingUsed);
    return { rawContentBase64: data.toString('base64'), encodingUsed };
  }

  async write(
    filesystem: RemoteFileSystem,
    remotePath: string,
    content: string,
    encoding = 'utf-8',
  ): Promise<RemoteFileEntry | null> {
    const normalizedEncoding = this.resolveRequestedEncoding(encoding);
    const original = await filesystem.metadata(remotePath).catch(() => null);
    const stream = await filesystem.openWrite(remotePath, original ? { mode: original.mode } : undefined);
    stream.end(iconv.encode(content, normalizedEncoding));
    await finished(stream);
    const metadata = await filesystem.metadata(remotePath).catch(() => null);
    return metadata ? toRemoteFileEntry(remotePath, metadata) : null;
  }

  private resolveRequestedEncoding(value: string): string {
    const normalized = normalizeEncoding(value);
    return iconv.encodingExists(normalized) ? normalized : 'utf-8';
  }

  private detectEncoding(data: Buffer): string {
    const detection = jschardet.detect(data);
    let detected = normalizeEncoding(detection.encoding || 'utf-8');
    if (detected === 'windows1252') detected = 'cp1252';
    if (detected === 'gb2312') detected = 'gbk';
    if (detected === 'utf8' || detected === 'ascii') return 'utf-8';
    if (['gbk', 'gb2312', 'gb18030', 'big5', 'euctw'].includes(detected)) return 'gb18030';
    return iconv.encodingExists(detected) ? detected : 'utf-8';
  }
}

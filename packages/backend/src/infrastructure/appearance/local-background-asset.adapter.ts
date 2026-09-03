import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BackgroundAssetContent, BackgroundAssetStore } from '../../modules/appearance/appearance-assets.port';

const PUBLIC_PREFIX = '/api/v1/appearance/background/file/';
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export class LocalBackgroundAssetAdapter implements BackgroundAssetStore {
  private readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = path.join(dataDirectory, 'background');
  }

  async save(content: Uint8Array, mimeType: string) {
    const extension = EXTENSION_BY_MIME[mimeType];
    if (!extension) throw new Error('Unsupported background MIME type.');
    await fs.mkdir(this.directory, { recursive: true });
    const fileName = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(this.directory, fileName), content, { flag: 'wx' });
    return { fileName, publicPath: `${PUBLIC_PREFIX}${fileName}` };
  }

  async read(fileName: string): Promise<BackgroundAssetContent | null> {
    const resolved = this.resolveFileName(fileName);
    if (!resolved) return null;
    try {
      const metadata = await fs.stat(resolved);
      if (!metadata.isFile()) return null;
      const extension = path.extname(fileName).toLowerCase();
      const contentType = MIME_BY_EXTENSION[extension];
      if (!contentType) return null;
      const { createReadStream } = await import('node:fs');
      return { stream: createReadStream(resolved), contentType, size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async existsPublicPath(publicPath: string): Promise<boolean> {
    const fileName = this.fileNameFromPublicPath(publicPath);
    if (!fileName) return false;
    const resolved = this.resolveFileName(fileName);
    if (!resolved) return false;
    try {
      return (await fs.stat(resolved)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async removePublicPath(publicPath: string): Promise<boolean> {
    const fileName = this.fileNameFromPublicPath(publicPath);
    if (!fileName) return false;
    const resolved = this.resolveFileName(fileName);
    if (!resolved) return false;
    try {
      await fs.unlink(resolved);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private fileNameFromPublicPath(publicPath: string): string | null {
    return publicPath.startsWith(PUBLIC_PREFIX) ? publicPath.slice(PUBLIC_PREFIX.length) : null;
  }

  private resolveFileName(fileName: string): string | null {
    if (!fileName || path.basename(fileName) !== fileName || fileName.includes('\\')) return null;
    const resolved = path.resolve(this.directory, fileName);
    return path.dirname(resolved) === path.resolve(this.directory) ? resolved : null;
  }
}

import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import type {
  ConnectionExportArchivePort,
  ConnectionExportFile,
} from '../../modules/connections/connection-export.port';

export class ZipConnectionExportAdapter implements ConnectionExportArchivePort {
  constructor(private readonly password: string) {}
  async encode(files: readonly ConnectionExportFile[]): Promise<Uint8Array> {
    if (!this.password.trim())
      throw new Error('ENCRYPTION_KEY is not set or is empty, cannot password-protect the ZIP file.');
    const writer = new ZipWriter(new Uint8ArrayWriter(), { password: this.password, encryptionStrength: 3, level: 9 });
    try {
      for (const file of files) await writer.add(file.path, new TextReader(file.text));
      return await writer.close();
    } catch (error) {
      try {
        await writer.close();
      } catch {
        /* preserve original */
      }
      throw error;
    }
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import type { HtmlThemeStore } from '../../modules/appearance/appearance-assets.port';

export interface LocalHtmlThemeStoreOptions {
  presetDirectory: string;
  dataDirectory: string;
}

export class LocalHtmlThemeStoreAdapter implements HtmlThemeStore {
  private readonly customDirectory: string;

  constructor(private readonly options: LocalHtmlThemeStoreOptions) {
    this.customDirectory = path.join(options.dataDirectory, 'custom_html_theme');
  }

  listPreset(): Promise<string[]> {
    return this.list(this.options.presetDirectory);
  }
  listCustom(): Promise<string[]> {
    return this.list(this.customDirectory);
  }
  readPreset(name: string): Promise<string | null> {
    return this.read(this.options.presetDirectory, name);
  }
  readCustom(name: string): Promise<string | null> {
    return this.read(this.customDirectory, name);
  }

  async createCustom(name: string, content: string): Promise<void> {
    await fs.mkdir(this.customDirectory, { recursive: true });
    await fs.writeFile(this.resolve(this.customDirectory, name), content, { encoding: 'utf8', flag: 'wx' });
  }

  async updateCustom(name: string, content: string): Promise<boolean> {
    const file = this.resolve(this.customDirectory, name);
    try {
      const metadata = await fs.stat(file);
      if (!metadata.isFile()) return false;
      await fs.writeFile(file, content, 'utf8');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async deleteCustom(name: string): Promise<boolean> {
    try {
      await fs.unlink(this.resolve(this.customDirectory, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async list(directory: string): Promise<string[]> {
    try {
      await fs.mkdir(directory, { recursive: true });
      return (await fs.readdir(directory)).filter((name) => name.endsWith('.html')).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async read(directory: string, name: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(directory, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private resolve(directory: string, name: string): string {
    const root = path.resolve(directory);
    const resolved = path.resolve(root, name);
    if (path.dirname(resolved) !== root || path.basename(name) !== name) throw new Error('Unsafe HTML theme path.');
    return resolved;
  }
}

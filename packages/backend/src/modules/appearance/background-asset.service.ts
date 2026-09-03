import type { BackgroundAssetStore } from './appearance-assets.port';
import type { AppearanceSettingsService } from './appearance-settings.service';
import type { BackgroundKind } from './appearance.types';

const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);

/** Owns background asset lifecycle and keeps settings/file storage consistent. */
export class BackgroundAssetService {
  constructor(
    private readonly store: BackgroundAssetStore,
    private readonly settings: AppearanceSettingsService,
  ) {}

  async upload(kind: BackgroundKind, content: Uint8Array, mimeType: string): Promise<{ filePath: string }> {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('只允许上传图片文件 (JPEG, PNG, GIF, WebP, SVG)！');
    if (content.byteLength <= 0) throw new Error('背景图片不能为空。');
    if (content.byteLength > MAX_BACKGROUND_BYTES) throw new Error('背景图片不能超过 5MB。');

    const current = await this.settings.get();
    const previous = kind === 'page' ? current.pageBackgroundImage : current.terminalBackgroundImage;
    const saved = await this.store.save(content, mimeType);
    try {
      await this.settings.setBackgroundReference(kind, saved.publicPath);
    } catch (error) {
      await this.store.removePublicPath(saved.publicPath).catch(() => false);
      throw error;
    }
    if (previous && previous !== saved.publicPath) await this.store.removePublicPath(previous).catch(() => false);
    return { filePath: saved.publicPath };
  }

  async remove(kind: BackgroundKind): Promise<boolean> {
    const current = await this.settings.get();
    const publicPath = kind === 'page' ? current.pageBackgroundImage : current.terminalBackgroundImage;
    if (publicPath) await this.store.removePublicPath(publicPath).catch(() => false);
    await this.settings.setBackgroundReference(kind, '');
    return true;
  }

  read(fileName: string) {
    if (!isSafeBackgroundFileName(fileName)) throw new Error('无效的文件名');
    return this.store.read(fileName);
  }
}

const isSafeBackgroundFileName = (value: string): boolean =>
  Boolean(value) &&
  value.length <= 255 &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes('..') &&
  /\.(?:jpe?g|jfif|png|gif|webp|svg)$/i.test(value);

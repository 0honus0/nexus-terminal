import type { HtmlThemeStore, RemoteHtmlThemeCatalog } from './appearance-assets.port';
import type { AppearanceSettingsService } from './appearance-settings.service';
import { parseGitHubThemeRepositoryUrl } from './appearance-settings.service';
import type { HtmlThemeSummary, RemoteHtmlThemeSummary } from './appearance.types';

const MAX_THEME_NAME_LENGTH = 255;
const MAX_HTML_BYTES = 1024 * 1024;

const assertThemeName = (name: string): string => {
  if (!name || typeof name !== 'string' || name.length > MAX_THEME_NAME_LENGTH) throw new Error('主题文件名无效。');
  if (
    !name.endsWith('.html') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    /[\0\r\n]/.test(name)
  ) {
    throw new Error(`主题文件名 "${name}" 包含非法字符或路径。`);
  }
  return name;
};

const assertHtmlContent = (content: string): void => {
  if (typeof content !== 'string') throw new Error('HTML 主题内容必须是字符串。');
  if (Buffer.byteLength(content, 'utf8') > MAX_HTML_BYTES) throw new Error('HTML 主题内容不能超过 1MB。');
};

/** Owns local/custom and remote HTML theme use cases. */
export class HtmlThemeService {
  constructor(
    private readonly store: HtmlThemeStore,
    private readonly remote: RemoteHtmlThemeCatalog,
    private readonly settings: AppearanceSettingsService,
  ) {}

  async listLocal(): Promise<HtmlThemeSummary[]> {
    const [presets, custom] = await Promise.all([this.store.listPreset(), this.store.listCustom()]);
    return [
      ...presets.map((name) => ({ name, type: 'preset' as const })),
      ...custom.map((name) => ({ name, type: 'custom' as const })),
    ];
  }

  async readLocal(name: string): Promise<string | null> {
    const safeName = assertThemeName(name);
    return (await this.store.readCustom(safeName)) ?? this.store.readPreset(safeName);
  }

  async createCustom(name: string, content: string): Promise<void> {
    const safeName = assertThemeName(name);
    assertHtmlContent(content);
    if (await this.store.readCustom(safeName)) throw new Error(`用户自定义 HTML 主题 "${safeName}" 已存在。`);
    await this.store.createCustom(safeName, content);
  }

  async updateCustom(name: string, content: string): Promise<void> {
    const safeName = assertThemeName(name);
    assertHtmlContent(content);
    if (!(await this.store.updateCustom(safeName, content)))
      throw new Error(`用户自定义 HTML 主题 "${safeName}" 未找到，无法更新。`);
  }

  async deleteCustom(name: string): Promise<void> {
    const safeName = assertThemeName(name);
    if (!(await this.store.deleteCustom(safeName)))
      throw new Error(`用户自定义 HTML 主题 "${safeName}" 未找到，无法删除。`);
  }

  async getRemoteRepositoryUrl(): Promise<string | null> {
    return (await this.settings.get()).remoteHtmlPresetsUrl;
  }

  async setRemoteRepositoryUrl(url: string | null): Promise<void> {
    await this.settings.update({ remoteHtmlPresetsUrl: url });
  }

  async listRemote(repoUrl?: string): Promise<RemoteHtmlThemeSummary[]> {
    const url = repoUrl?.trim() || (await this.getRemoteRepositoryUrl());
    if (!url) throw new Error('未提供远程仓库链接，且未找到已保存的链接。');
    const repository = parseGitHubThemeRepositoryUrl(url);
    if (!repository) throw new Error(`无效的 GitHub 仓库链接格式: ${url}`);
    return this.remote.list(repository);
  }

  async readRemote(fileUrl: string): Promise<string> {
    if (!fileUrl || typeof fileUrl !== 'string') throw new Error('无效的远程文件 URL。');
    let parsed: URL;
    try {
      parsed = new URL(fileUrl);
    } catch {
      throw new Error('文件 URL 格式无效。');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'raw.githubusercontent.com' ||
      parsed.port ||
      !parsed.pathname.toLowerCase().endsWith('.html')
    ) {
      throw new Error('仅允许从 raw.githubusercontent.com 获取 HTTPS HTML 主题。');
    }
    return this.remote.readRawHtml(fileUrl);
  }
}

import type { BackgroundAssetStore } from './appearance-assets.port';
import type { AppearanceSettingsRepository } from './appearance-settings.repository.port';
import type { AppearanceSettings, UpdateAppearanceInput } from './appearance.types';
import { defaultUiTheme } from './default-ui-theme';

const DEFAULT_REMOTE_HTML_PRESETS_URL = 'https://github.com/0honus0/nexus-terminal/tree/main/doc/custom_html_theme';
const LEGACY_REMOTE_HTML_PRESETS_URLS = new Set([
  'https://github.com/Heavrnl/nexus-terminal/tree/main/doc/custom_html_theme',
]);

export interface TerminalThemeLookup {
  get(id: number): Promise<unknown | null>;
  findDefaultThemeId(): Promise<number | null>;
}

const defaultSettings = (): AppearanceSettings => ({
  _id: 'global_appearance',
  customUiTheme: JSON.stringify(defaultUiTheme),
  activeTerminalThemeId: null,
  terminalFontFamily: 'Consolas, "Courier New", monospace, "Microsoft YaHei", "微软雅黑"',
  terminalFontSize: 14,
  terminalFontSizeMobile: 14,
  editorFontSize: 14,
  mobileEditorFontSize: 16,
  editorFontFamily: 'Consolas, "Noto Sans SC", "Microsoft YaHei"',
  terminalBackgroundImage: undefined,
  pageBackgroundImage: undefined,
  terminalBackgroundEnabled: true,
  terminalBackgroundOverlayOpacity: 0.5,
  terminal_custom_html: '',
  remoteHtmlPresetsUrl: DEFAULT_REMOTE_HTML_PRESETS_URL,
  windowThemeColor: '#343A40',
  terminalTextStrokeEnabled: false,
  terminalTextStrokeWidth: 1,
  terminalTextStrokeColor: '#000000',
  terminalTextShadowEnabled: false,
  terminalTextShadowOffsetX: 2,
  terminalTextShadowOffsetY: 2,
  terminalTextShadowBlur: 0,
  terminalTextShadowColor: '#000000',
  updatedAt: Date.now(),
});

const storageKey = (key: keyof UpdateAppearanceInput): string =>
  key === 'remoteHtmlPresetsUrl' ? 'remote_html_presets_url' : key;

const serialize = (key: keyof UpdateAppearanceInput, value: UpdateAppearanceInput[typeof key]): string => {
  if (key === 'activeTerminalThemeId') return value === null || value === undefined ? 'null' : String(value);
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const assertPositive = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} 必须是正数。`);
  return parsed;
};

const assertFiniteRange = (value: unknown, field: string, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} 必须是 ${min} 到 ${max} 之间的数字。`);
  }
  return parsed;
};

/** Application service for appearance settings only; no direct filesystem or HTTP access. */
export class AppearanceSettingsService {
  constructor(
    private readonly repository: AppearanceSettingsRepository,
    private readonly themes: TerminalThemeLookup,
    private readonly backgrounds: BackgroundAssetStore,
  ) {}

  async initialize(): Promise<void> {
    const defaults = defaultSettings();
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (key === '_id' || key === 'updatedAt') continue;
      values[storageKey(key as keyof UpdateAppearanceInput)] = serialize(
        key as keyof UpdateAppearanceInput,
        value as never,
      );
    }
    await this.repository.ensure(values);

    const current = await this.get(false);
    if (current.activeTerminalThemeId === null) {
      const defaultThemeId = await this.themes.findDefaultThemeId();
      if (defaultThemeId !== null) await this.repository.setMany({ activeTerminalThemeId: String(defaultThemeId) });
    }

    const remote = current.remoteHtmlPresetsUrl?.trim().replace(/\/+$/, '') ?? '';
    if (!remote || LEGACY_REMOTE_HTML_PRESETS_URLS.has(remote)) {
      await this.repository.setMany({ remote_html_presets_url: DEFAULT_REMOTE_HTML_PRESETS_URL });
    }
  }

  get(): Promise<AppearanceSettings>;
  get(cleanBackgroundReferences: boolean): Promise<AppearanceSettings>;
  async get(cleanBackgroundReferences = true): Promise<AppearanceSettings> {
    const rows = await this.repository.list();
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const defaults = defaultSettings();
    const activeRaw = values.get('activeTerminalThemeId');
    const parsedActive = activeRaw && activeRaw !== 'null' ? Number.parseInt(activeRaw, 10) : null;
    const latestUpdatedAt = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0);

    const settings: AppearanceSettings = {
      _id: 'global_appearance',
      customUiTheme: values.get('customUiTheme') ?? defaults.customUiTheme,
      activeTerminalThemeId: Number.isInteger(parsedActive) ? parsedActive : null,
      terminalFontFamily: values.get('terminalFontFamily') ?? defaults.terminalFontFamily,
      terminalFontSize: parseNumber(values.get('terminalFontSize'), defaults.terminalFontSize),
      terminalFontSizeMobile: parseNumber(values.get('terminalFontSizeMobile'), defaults.terminalFontSizeMobile),
      editorFontSize: parseNumber(values.get('editorFontSize'), defaults.editorFontSize),
      mobileEditorFontSize: parseNumber(values.get('mobileEditorFontSize'), defaults.mobileEditorFontSize),
      editorFontFamily: values.has('editorFontFamily')
        ? values.get('editorFontFamily') || null
        : defaults.editorFontFamily,
      terminalBackgroundImage: values.get('terminalBackgroundImage') || undefined,
      pageBackgroundImage: values.get('pageBackgroundImage') || undefined,
      terminalBackgroundEnabled: values.has('terminalBackgroundEnabled')
        ? values.get('terminalBackgroundEnabled') === 'true'
        : defaults.terminalBackgroundEnabled,
      terminalBackgroundOverlayOpacity: parseNumber(
        values.get('terminalBackgroundOverlayOpacity'),
        defaults.terminalBackgroundOverlayOpacity,
      ),
      terminal_custom_html: values.get('terminal_custom_html') ?? defaults.terminal_custom_html,
      remoteHtmlPresetsUrl:
        values.get('remote_html_presets_url') || values.get('remoteHtmlPresetsUrl') || defaults.remoteHtmlPresetsUrl,
      windowThemeColor: values.get('windowThemeColor') ?? defaults.windowThemeColor,
      terminalTextStrokeEnabled: values.has('terminalTextStrokeEnabled')
        ? values.get('terminalTextStrokeEnabled') === 'true'
        : defaults.terminalTextStrokeEnabled,
      terminalTextStrokeWidth: parseNumber(values.get('terminalTextStrokeWidth'), defaults.terminalTextStrokeWidth),
      terminalTextStrokeColor: values.get('terminalTextStrokeColor') ?? defaults.terminalTextStrokeColor,
      terminalTextShadowEnabled: values.has('terminalTextShadowEnabled')
        ? values.get('terminalTextShadowEnabled') === 'true'
        : defaults.terminalTextShadowEnabled,
      terminalTextShadowOffsetX: parseNumber(
        values.get('terminalTextShadowOffsetX'),
        defaults.terminalTextShadowOffsetX,
      ),
      terminalTextShadowOffsetY: parseNumber(
        values.get('terminalTextShadowOffsetY'),
        defaults.terminalTextShadowOffsetY,
      ),
      terminalTextShadowBlur: parseNumber(values.get('terminalTextShadowBlur'), defaults.terminalTextShadowBlur),
      terminalTextShadowColor: values.get('terminalTextShadowColor') ?? defaults.terminalTextShadowColor,
      updatedAt: latestUpdatedAt || defaults.updatedAt,
    };

    if (cleanBackgroundReferences) await this.clearMissingBackgroundReferences(settings);
    return settings;
  }

  async update(input: UpdateAppearanceInput): Promise<AppearanceSettings> {
    const normalized = await this.validateAndNormalize(input);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(normalized)) {
      values[storageKey(key as keyof UpdateAppearanceInput)] = serialize(
        key as keyof UpdateAppearanceInput,
        value as never,
      );
    }
    if (Object.keys(values).length > 0) await this.repository.setMany(values);
    return this.get();
  }

  async setBackgroundReference(kind: 'page' | 'terminal', publicPath: string): Promise<void> {
    await this.repository.setMany({
      [kind === 'page' ? 'pageBackgroundImage' : 'terminalBackgroundImage']: publicPath,
    });
  }

  private async validateAndNormalize(input: UpdateAppearanceInput): Promise<UpdateAppearanceInput> {
    const output: UpdateAppearanceInput = { ...input };
    if (input.activeTerminalThemeId !== undefined && input.activeTerminalThemeId !== null) {
      if (!Number.isInteger(input.activeTerminalThemeId) || input.activeTerminalThemeId <= 0)
        throw new Error('无效的终端主题 ID。');
      if (!(await this.themes.get(input.activeTerminalThemeId)))
        throw new Error(`指定的终端主题 ID 不存在: ${input.activeTerminalThemeId}`);
    }
    if (input.terminalFontSize !== undefined)
      output.terminalFontSize = assertPositive(input.terminalFontSize, '终端字体大小');
    if (input.terminalFontSizeMobile !== undefined)
      output.terminalFontSizeMobile = assertPositive(input.terminalFontSizeMobile, '移动端终端字体大小');
    if (input.editorFontSize !== undefined)
      output.editorFontSize = assertPositive(input.editorFontSize, '编辑器字体大小');
    if (input.mobileEditorFontSize !== undefined)
      output.mobileEditorFontSize = assertPositive(input.mobileEditorFontSize, '移动端编辑器字体大小');
    if (input.editorFontFamily !== undefined && input.editorFontFamily !== null) {
      if (typeof input.editorFontFamily !== 'string' || input.editorFontFamily.length > 255)
        throw new Error('编辑器字体名称无效。');
    }
    if (input.terminalBackgroundOverlayOpacity !== undefined) {
      output.terminalBackgroundOverlayOpacity = assertFiniteRange(
        input.terminalBackgroundOverlayOpacity,
        '终端背景蒙版透明度',
        0,
        1,
      );
    }
    if (input.terminal_custom_html !== undefined) {
      if (typeof input.terminal_custom_html !== 'string' || input.terminal_custom_html.length > 10_240) {
        throw new Error('自定义终端 HTML 过长或格式无效，最多允许 10240 个字符。');
      }
    }
    if (input.remoteHtmlPresetsUrl !== undefined) {
      const value = input.remoteHtmlPresetsUrl?.trim() || null;
      if (value !== null && value.length > 1024) throw new Error('远程 HTML 主题仓库链接过长，最多允许 1024 个字符。');
      if (value !== null && !parseGitHubThemeRepositoryUrl(value)) {
        throw new Error('无效的 GitHub 仓库链接。仅允许 HTTPS GitHub 仓库地址。');
      }
      output.remoteHtmlPresetsUrl = value;
    }
    if (input.windowThemeColor !== undefined) {
      if (typeof input.windowThemeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.windowThemeColor.trim())) {
        throw new Error('窗口标题栏颜色必须是 #RRGGBB 格式');
      }
      output.windowThemeColor = input.windowThemeColor.trim().toUpperCase();
    }
    return output;
  }

  private async clearMissingBackgroundReferences(settings: AppearanceSettings): Promise<void> {
    for (const kind of ['page', 'terminal'] as const) {
      const key = kind === 'page' ? 'pageBackgroundImage' : 'terminalBackgroundImage';
      const publicPath = settings[key];
      if (!publicPath || (await this.backgrounds.existsPublicPath(publicPath))) continue;
      settings[key] = undefined;
      await this.repository.setMany({ [key]: '' });
    }
  }
}

export const parseGitHubThemeRepositoryUrl = (repoUrl: string) => {
  try {
    const parsedUrl = new URL(repoUrl);
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname !== 'github.com' ||
      parsedUrl.port ||
      parsedUrl.username ||
      parsedUrl.password
    )
      return null;
    const segments = parsedUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments.length < 2) return null;
    const owner = segments[0]!;
    const repository = segments[1]!.replace(/\.git$/i, '');
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return null;
    if (segments.length === 2) return { owner, repository, ref: 'HEAD', path: '' };
    if (segments[2] !== 'tree' || !segments[3]) return null;
    return { owner, repository, ref: segments[3], path: segments.slice(4).join('/') };
  } catch {
    return null;
  }
};

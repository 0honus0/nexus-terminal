import type {
  CaptchaProvider,
  CaptchaSettings,
  LayoutNode,
  PaneName,
  SidebarConfig,
  UpdateCaptchaSettingsDto,
  UpdateSidebarConfigDto,
} from './settings.types';
import type { SettingsMigrationRepository } from './settings-migration.repository.port';
import type { SettingsRepository } from './settings.repository.port';
import { runSettingsMigrations } from './settings-migrations';

export interface FocusItemConfig {
  shortcut?: string;
}
export interface FocusSwitcherFullConfig {
  sequence: string[];
  shortcuts: Record<string, FocusItemConfig>;
}

const KEYS = {
  sidebar: 'sidebarConfig',
  captcha: 'captchaConfig',
  focus: 'focusSwitcherSequence',
  nav: 'navBarVisible',
  layout: 'layoutTree',
  terminalRightClickCopyPaste: 'terminalRightClickCopyPaste',
  statusInterval: 'statusMonitorIntervalSeconds',
  remoteRefresh: 'remoteHostRefreshIntervalSeconds',
  blacklist: 'ipBlacklistEnabled',
  showConnectionTags: 'showConnectionTags',
  showQuickCommandTags: 'showQuickCommandTags',
  showStatusIp: 'showStatusMonitorIpAddress',
} as const;
const VALID_PANES: ReadonlySet<PaneName> = new Set([
  'connections',
  'terminal',
  'commandBar',
  'fileManager',
  'editor',
  'statusMonitor',
  'commandHistory',
  'quickCommands',
  'dockerManager',
  'suspendedSshSessions',
]);
const DEFAULT_SIDEBAR: SidebarConfig = { left: ['connections', 'dockerManager'], right: [] };
const DEFAULT_CAPTCHA: CaptchaSettings = {
  enabled: false,
  provider: 'none',
  hcaptchaSiteKey: '',
  hcaptchaSecretKey: '',
  recaptchaSiteKey: '',
  recaptchaSecretKey: '',
};
const DEFAULT_LAYOUT: Omit<LayoutNode, 'id'> = {
  type: 'container',
  direction: 'horizontal',
  children: [
    {
      id: 'left',
      type: 'container',
      direction: 'vertical',
      size: 14.59,
      children: [
        { id: 'status', type: 'pane', component: 'statusMonitor', size: 44.56 },
        { id: 'history', type: 'pane', component: 'commandHistory', size: 26.24 },
        { id: 'quick', type: 'pane', component: 'quickCommands', size: 29.2 },
      ],
    },
    {
      id: 'center',
      type: 'container',
      direction: 'vertical',
      size: 58.03,
      children: [
        { id: 'terminal', type: 'pane', component: 'terminal', size: 59.95 },
        { id: 'command', type: 'pane', component: 'commandBar', size: 5 },
        { id: 'files', type: 'pane', component: 'fileManager', size: 35.05 },
      ],
    },
    {
      id: 'right',
      type: 'container',
      direction: 'vertical',
      size: 27.38,
      children: [{ id: 'editor', type: 'pane', component: 'editor', size: 100 }],
    },
  ],
};

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly migrations: SettingsMigrationRepository,
  ) {}
  async ensureDefaults(): Promise<void> {
    const defaults: Record<string, string> = {
      ipWhitelist: '',
      maxLoginAttempts: '5',
      loginBanDuration: '300',
      ipBlacklistEnabled: 'true',
      [KEYS.focus]: JSON.stringify({
        sequence: [
          'quickCommandsSearch',
          'commandHistorySearch',
          'fileManagerSearch',
          'commandInput',
          'terminalSearch',
        ],
        shortcuts: {},
      }),
      [KEYS.nav]: 'true',
      [KEYS.layout]: JSON.stringify(DEFAULT_LAYOUT),
      showPopupFileEditor: 'false',
      shareFileEditorTabs: 'true',
      dockerStatusIntervalSeconds: '5',
      dockerDefaultExpand: 'false',
      [KEYS.statusInterval]: '3',
      [KEYS.remoteRefresh]: '30',
      statusMonitorScale: '1.0',
      dashboardShowLocalResources: 'true',
      dashboardShowRemoteResources: 'true',
      quickCommandsCollapsibleSearch: 'false',
      quickCommandsCompactMode: 'false',
      quickCommandRowSizeMultiplier: '1.0',
      [KEYS.sidebar]: JSON.stringify(DEFAULT_SIDEBAR),
      [KEYS.captcha]: JSON.stringify(DEFAULT_CAPTCHA),
      timezone: 'UTC',
      terminalScrollbackLimit: '5000',
      spreadsheetPreviewRowsPerPage: '500',
      spreadsheetPreviewMaxColumns: '100',
      [KEYS.terminalRightClickCopyPaste]: 'true',
      [KEYS.showConnectionTags]: 'true',
      [KEYS.showQuickCommandTags]: 'true',
      [KEYS.showStatusIp]: 'true',
    };
    const existing = await runSettingsMigrations(this.repository, this.migrations);
    const missing = Object.fromEntries(Object.entries(defaults).filter(([key]) => existing[key] === undefined));
    if (Object.keys(missing).length) await this.repository.setMany(missing);
  }
  async getAllSettings(): Promise<Record<string, string>> {
    return Object.fromEntries((await this.repository.list()).map((v) => [v.key, v.value]));
  }
  getSetting(key: string) {
    return this.repository.get(key);
  }
  setSetting(key: string, value: string) {
    return this.repository.set(key, value);
  }
  setMultipleSettings(values: Record<string, string>) {
    return this.repository.setMany(values);
  }
  async deleteSetting(key: string) {
    await this.repository.delete(key);
  }
  async isIpBlacklistEnabled() {
    return (await this.repository.get(KEYS.blacklist)) !== 'false';
  }
  async getFocusSwitcherSequence(): Promise<FocusSwitcherFullConfig> {
    const raw = await this.repository.get(KEYS.focus);
    if (!raw) return { sequence: [], shortcuts: {} };
    try {
      const value = JSON.parse(raw);
      return this.validFocus(value) ? value : { sequence: [], shortcuts: {} };
    } catch {
      return { sequence: [], shortcuts: {} };
    }
  }
  async setFocusSwitcherSequence(value: FocusSwitcherFullConfig) {
    if (!this.validFocus(value)) throw new Error('Invalid focus switcher configuration.');
    await this.repository.set(KEYS.focus, JSON.stringify(value));
  }
  async getNavBarVisibility() {
    return (await this.repository.get(KEYS.nav)) !== 'false';
  }
  setNavBarVisibility(value: boolean) {
    return this.repository.set(KEYS.nav, String(value));
  }
  getLayoutTree() {
    return this.repository.get(KEYS.layout);
  }
  async setLayoutTree(value: string) {
    JSON.parse(value);
    await this.repository.set(KEYS.layout, value);
  }
  async getStatusMonitorIntervalSeconds() {
    return this.readBoundedInt(KEYS.statusInterval, 3, 1, 86400);
  }
  async setStatusMonitorIntervalSeconds(v: number) {
    this.assertInt(v, 1, 86400);
    await this.repository.set(KEYS.statusInterval, String(v));
  }
  async getRemoteHostRefreshIntervalSeconds() {
    return this.readBoundedInt(KEYS.remoteRefresh, 30, 1, 86400);
  }
  async setRemoteHostRefreshIntervalSeconds(v: number) {
    this.assertInt(v, 1, 86400);
    await this.repository.set(KEYS.remoteRefresh, String(v));
  }
  async getSidebarConfig(): Promise<SidebarConfig> {
    return this.readJson(KEYS.sidebar, DEFAULT_SIDEBAR, (value) =>
      Boolean(value && Array.isArray(value.left) && Array.isArray(value.right)),
    );
  }
  async setSidebarConfig(config: UpdateSidebarConfigDto) {
    if (!config || !Array.isArray(config.left) || !Array.isArray(config.right))
      throw new Error('Invalid sidebar configuration.');
    for (const pane of [...config.left, ...config.right])
      if (!VALID_PANES.has(pane)) throw new Error(`Invalid sidebar pane: ${pane}`);
    await this.repository.set(KEYS.sidebar, JSON.stringify({ left: config.left, right: config.right }));
  }
  async getCaptchaConfig(): Promise<CaptchaSettings> {
    return this.readJson(KEYS.captcha, DEFAULT_CAPTCHA, (value) =>
      Boolean(value && typeof value.enabled === 'boolean' && typeof value.provider === 'string'),
    );
  }
  async setCaptchaConfig(dto: UpdateCaptchaSettingsDto) {
    const current = await this.getCaptchaConfig();
    const next = { ...current, ...dto };
    const providers: CaptchaProvider[] = ['hcaptcha', 'recaptcha', 'none'];
    if (typeof next.enabled !== 'boolean' || !providers.includes(next.provider))
      throw new Error('Invalid CAPTCHA configuration.');
    for (const key of ['hcaptchaSiteKey', 'hcaptchaSecretKey', 'recaptchaSiteKey', 'recaptchaSecretKey'] as const)
      if (next[key] !== undefined && typeof next[key] !== 'string') throw new Error(`${key} must be a string.`);
    await this.repository.set(KEYS.captcha, JSON.stringify(next));
  }
  async getShowConnectionTags() {
    return (await this.repository.get(KEYS.showConnectionTags)) !== 'false';
  }
  setShowConnectionTags(v: boolean) {
    return this.repository.set(KEYS.showConnectionTags, String(v));
  }
  async getShowQuickCommandTags() {
    return (await this.repository.get(KEYS.showQuickCommandTags)) !== 'false';
  }
  setShowQuickCommandTags(v: boolean) {
    return this.repository.set(KEYS.showQuickCommandTags, String(v));
  }
  async getShowStatusMonitorIpAddress() {
    return (await this.repository.get(KEYS.showStatusIp)) !== 'false';
  }
  setShowStatusMonitorIpAddress(v: boolean) {
    return this.repository.set(KEYS.showStatusIp, String(v));
  }
  private async readBoundedInt(key: string, fallback: number, min: number, max: number) {
    const value = Number.parseInt((await this.repository.get(key)) ?? '', 10);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  private assertInt(value: number, min: number, max: number) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Value must be an integer from ${min} to ${max}.`);
  }
  private async readJson<T>(key: string, fallback: T, valid: (v: any) => boolean): Promise<T> {
    const raw = await this.repository.get(key);
    if (!raw) return fallback;
    try {
      const v = JSON.parse(raw);
      return valid(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private validFocus(value: any): value is FocusSwitcherFullConfig {
    return Boolean(
      value &&
      Array.isArray(value.sequence) &&
      value.sequence.every((v: any) => typeof v === 'string') &&
      value.shortcuts &&
      typeof value.shortcuts === 'object' &&
      Object.values(value.shortcuts).every(
        (v: any) => v && typeof v === 'object' && (v.shortcut === undefined || typeof v.shortcut === 'string'),
      ),
    );
  }
}

import type { CaptchaConfigUpdateDto, CaptchaProviderDto } from '@nexus-terminal/protocol/auth';
import type {
  WorkspaceFocusConfigDto,
  WorkspaceLayoutNodeDto,
  WorkspacePaneNameDto,
  WorkspaceSidebarConfigDto,
} from '@nexus-terminal/protocol/settings';
import type { SettingsMigrationRepository } from './settings-migration.repository.port';
import type { SettingsRepository } from './settings.repository.port';
import { runSettingsMigrations } from './settings-migrations';
import { setBackendLogLevel } from '../../shared/logging/logger';

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
  frontendLogLevel: 'frontendLogLevel',
  backendLogLevel: 'backendLogLevel',
} as const;
const VALID_PANES: ReadonlySet<WorkspacePaneNameDto> = new Set([
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
const DEFAULT_SIDEBAR: WorkspaceSidebarConfigDto = { left: ['connections', 'dockerManager'], right: [] };
const DEFAULT_CAPTCHA: CaptchaConfigUpdateDto = {
  enabled: false,
  provider: 'none',
  hcaptchaSiteKey: '',
  hcaptchaSecretKey: '',
  recaptchaSiteKey: '',
  recaptchaSecretKey: '',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPaneName = (value: unknown): value is WorkspacePaneNameDto =>
  typeof value === 'string' && VALID_PANES.has(value as WorkspacePaneNameDto);

const isSidebarConfig = (value: unknown): value is WorkspaceSidebarConfigDto =>
  isRecord(value) &&
  Array.isArray(value.left) &&
  value.left.every(isPaneName) &&
  Array.isArray(value.right) &&
  value.right.every(isPaneName);

const isCaptchaProvider = (value: unknown): value is CaptchaProviderDto =>
  value === 'hcaptcha' || value === 'recaptcha' || value === 'none';

const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';

const isCaptchaSettings = (value: unknown): value is CaptchaConfigUpdateDto =>
  isRecord(value) &&
  typeof value.enabled === 'boolean' &&
  isCaptchaProvider(value.provider) &&
  isOptionalString(value.hcaptchaSiteKey) &&
  isOptionalString(value.hcaptchaSecretKey) &&
  isOptionalString(value.recaptchaSiteKey) &&
  isOptionalString(value.recaptchaSecretKey);
const DEFAULT_LAYOUT: WorkspaceLayoutNodeDto = {
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
      [KEYS.frontendLogLevel]: 'info',
      [KEYS.backendLogLevel]: 'info',
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
      [KEYS.showStatusIp]: 'false',
    };
    const existing = await runSettingsMigrations(this.repository, this.migrations);
    const missing = Object.fromEntries(Object.entries(defaults).filter(([key]) => existing[key] === undefined));
    if (Object.keys(missing).length) await this.repository.setMany(missing);
    setBackendLogLevel(existing[KEYS.backendLogLevel] ?? missing[KEYS.backendLogLevel] ?? 'info');
  }
  async getAllSettings(): Promise<Record<string, string>> {
    return Object.fromEntries((await this.repository.list()).map((v) => [v.key, v.value]));
  }
  getSetting(key: string) {
    return this.repository.get(key);
  }
  async setSetting(key: string, value: string) {
    await this.repository.set(key, value);
    if (key === KEYS.backendLogLevel) setBackendLogLevel(value, true);
  }
  async setMultipleSettings(values: Record<string, string>) {
    await this.repository.setMany(values);
    if (values[KEYS.backendLogLevel] !== undefined) setBackendLogLevel(values[KEYS.backendLogLevel], true);
  }
  async deleteSetting(key: string) {
    await this.repository.delete(key);
  }
  async isIpBlacklistEnabled() {
    return (await this.repository.get(KEYS.blacklist)) !== 'false';
  }
  async getFocusSwitcherSequence(): Promise<WorkspaceFocusConfigDto> {
    const raw = await this.repository.get(KEYS.focus);
    if (!raw) return { sequence: [], shortcuts: {} };
    try {
      const value: unknown = JSON.parse(raw);
      return this.validFocus(value) ? value : { sequence: [], shortcuts: {} };
    } catch {
      return { sequence: [], shortcuts: {} };
    }
  }
  async setFocusSwitcherSequence(value: WorkspaceFocusConfigDto) {
    if (!this.validFocus(value)) throw new Error('Invalid focus switcher configuration.');
    await this.repository.set(KEYS.focus, JSON.stringify(value));
  }
  getLayoutTree() {
    return this.repository.get(KEYS.layout);
  }
  async setLayoutTree(value: string) {
    JSON.parse(value);
    await this.repository.set(KEYS.layout, value);
  }
  async setWorkspaceLayoutConfig(layout: string, config: WorkspaceSidebarConfigDto) {
    JSON.parse(layout);
    const sidebar = this.normalizeSidebarConfig(config);
    await this.repository.setMany({
      [KEYS.layout]: layout,
      [KEYS.sidebar]: JSON.stringify(sidebar),
    });
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
  async getSidebarConfig(): Promise<WorkspaceSidebarConfigDto> {
    return this.readJson(KEYS.sidebar, DEFAULT_SIDEBAR, isSidebarConfig);
  }
  async setSidebarConfig(config: WorkspaceSidebarConfigDto) {
    await this.repository.set(KEYS.sidebar, JSON.stringify(this.normalizeSidebarConfig(config)));
  }
  async getCaptchaConfig(): Promise<CaptchaConfigUpdateDto> {
    return this.readJson(KEYS.captcha, DEFAULT_CAPTCHA, isCaptchaSettings);
  }
  async setCaptchaConfig(dto: CaptchaConfigUpdateDto) {
    const current = await this.getCaptchaConfig();
    const next = { ...current, ...dto };
    if (typeof next.enabled !== 'boolean' || !isCaptchaProvider(next.provider))
      throw new Error('Invalid CAPTCHA configuration.');
    for (const key of ['hcaptchaSiteKey', 'hcaptchaSecretKey', 'recaptchaSiteKey', 'recaptchaSecretKey'] as const)
      if (next[key] !== undefined && typeof next[key] !== 'string') throw new Error(`${key} must be a string.`);
    await this.repository.set(KEYS.captcha, JSON.stringify(next));
  }
  private async readBoundedInt(key: string, fallback: number, min: number, max: number) {
    const value = Number.parseInt((await this.repository.get(key)) ?? '', 10);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  private assertInt(value: number, min: number, max: number) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Value must be an integer from ${min} to ${max}.`);
  }
  private async readJson<T>(key: string, fallback: T, valid: (value: unknown) => value is T): Promise<T> {
    const raw = await this.repository.get(key);
    if (!raw) return fallback;
    try {
      const value: unknown = JSON.parse(raw);
      return valid(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }
  private normalizeSidebarConfig(config: unknown): WorkspaceSidebarConfigDto {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Invalid sidebar configuration.');
    const candidate = config as { left?: unknown; right?: unknown };
    if (!Array.isArray(candidate.left) || !Array.isArray(candidate.right))
      throw new Error('Invalid sidebar configuration.');
    const panes = [...candidate.left, ...candidate.right];
    if (
      !panes.every(
        (pane): pane is WorkspacePaneNameDto =>
          typeof pane === 'string' && VALID_PANES.has(pane as WorkspacePaneNameDto),
      )
    ) {
      const invalid = panes.find((pane) => typeof pane !== 'string' || !VALID_PANES.has(pane as WorkspacePaneNameDto));
      throw new Error(`Invalid sidebar pane: ${String(invalid)}`);
    }
    if (new Set(panes).size !== panes.length) throw new Error('Duplicate sidebar panes are not allowed.');
    return {
      left: [...candidate.left] as WorkspacePaneNameDto[],
      right: [...candidate.right] as WorkspacePaneNameDto[],
    };
  }
  private validFocus(value: unknown): value is WorkspaceFocusConfigDto {
    if (
      !isRecord(value) ||
      !Array.isArray(value.sequence) ||
      !value.sequence.every((entry) => typeof entry === 'string')
    ) {
      return false;
    }
    if (!isRecord(value.shortcuts)) return false;
    return Object.values(value.shortcuts).every(
      (entry) => isRecord(entry) && (entry.shortcut === undefined || typeof entry.shortcut === 'string'),
    );
  }
}

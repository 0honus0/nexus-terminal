import { Router } from 'express';
import type { CaptchaConfigDto, CaptchaConfigUpdateDto, IpBlacklistPageDto } from '@nexus-terminal/protocol/auth';
import type {
  SettingsResponseDto,
  SettingsUpdateRequestDto,
  WorkspaceFocusConfigDto,
  WorkspaceLayoutNodeDto,
  WorkspaceLayoutSettingsRequestDto,
  WorkspacePaneNameDto,
  WorkspaceSidebarConfigDto,
} from '@nexus-terminal/protocol/settings';
import multer from 'multer';
import type { BackupService } from '../../../modules/backup/backup.service';
import { BackupPasswordRequiredError, InvalidBackupPasswordError } from '../../../shared/errors/backup.errors';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { IpBlacklistService } from '../../../modules/auth/ip-blacklist.service';
import type { NotificationService } from '../../../modules/notifications/notification.service';
import type { SettingsService } from '../../../modules/settings/settings.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, isRecord } from '../shared/http-utils';
import { route } from '../shared/route-handler';
import { isLogLevel } from '../../../shared/logging/log-level';

export interface SettingsRouterDependencies {
  backup: BackupService;
  settings: SettingsService;
  ipBlacklist: IpBlacklistService;
  audit: AuditLogService;
  notifications: NotificationService;
}

const ALLOWED_SETTING_KEYS = new Set<keyof SettingsUpdateRequestDto>([
  'language',
  'frontendLogLevel',
  'backendLogLevel',
  'ipWhitelist',
  'maxLoginAttempts',
  'loginBanDuration',
  'showPopupFileEditor',
  'shareFileEditorTabs',
  'dockerStatusIntervalSeconds',
  'dockerDefaultExpand',
  'statusMonitorIntervalSeconds',
  'remoteHostRefreshIntervalSeconds',
  'statusMonitorScale',
  'dashboardShowLocalResources',
  'dashboardShowRemoteResources',
  'workspaceSidebarPersistent',
  'showPopupFileManager',
  'sidebarPaneWidths',
  'fileManagerRowSizeMultiplier',
  'fileManagerColWidths',
  'commandInputSyncTarget',
  'timezone',
  'rdpModalWidth',
  'rdpModalHeight',
  'vncModalWidth',
  'vncModalHeight',
  'ipBlacklistEnabled',
  'layoutLocked',
  'terminalScrollbackLimit',
  'spreadsheetPreviewRowsPerPage',
  'spreadsheetPreviewMaxColumns',
  'fileManagerShowDeleteConfirmation',
  'terminalRightClickCopyPaste',
  'showStatusMonitorIpAddress',
  'quickCommandsCollapsibleSearch',
  'quickCommandsCompactMode',
  'quickCommandRowSizeMultiplier',
  'navBarVisible',
  'showConnectionTags',
  'showQuickCommandTags',
]);

const BOUNDED_INTEGER_SETTINGS: Record<string, { min: number; max: number }> = {
  maxLoginAttempts: { min: 1, max: 1000 },
  loginBanDuration: { min: 1, max: 86400 * 30 },
  dockerStatusIntervalSeconds: { min: 1, max: 86400 },
  statusMonitorIntervalSeconds: { min: 1, max: 86400 },
  remoteHostRefreshIntervalSeconds: { min: 1, max: 86400 },
  terminalScrollbackLimit: { min: 0, max: 100000 },
  spreadsheetPreviewRowsPerPage: { min: 10, max: 2000 },
  spreadsheetPreviewMaxColumns: { min: 5, max: 200 },
};

const BOUNDED_NUMBER_SETTINGS: Record<string, { min: number; max: number }> = {
  statusMonitorScale: { min: 0.65, max: 1.6 },
  fileManagerRowSizeMultiplier: { min: 0.5, max: 2 },
  quickCommandRowSizeMultiplier: { min: 0.5, max: 2.5 },
};

const BOOLEAN_SETTING_KEYS = new Set<keyof SettingsUpdateRequestDto>([
  'showPopupFileEditor',
  'shareFileEditorTabs',
  'showPopupFileManager',
  'dockerDefaultExpand',
  'dashboardShowLocalResources',
  'dashboardShowRemoteResources',
  'workspaceSidebarPersistent',
  'showStatusMonitorIpAddress',
  'quickCommandsCollapsibleSearch',
  'quickCommandsCompactMode',
  'terminalRightClickCopyPaste',
  'layoutLocked',
  'fileManagerShowDeleteConfirmation',
  'ipBlacklistEnabled',
  'navBarVisible',
  'showConnectionTags',
  'showQuickCommandTags',
]);

const NUMBER_SETTING_KEYS = new Set<keyof SettingsUpdateRequestDto>([
  'maxLoginAttempts',
  'loginBanDuration',
  'dockerStatusIntervalSeconds',
  'statusMonitorIntervalSeconds',
  'remoteHostRefreshIntervalSeconds',
  'statusMonitorScale',
  'terminalScrollbackLimit',
  'fileManagerRowSizeMultiplier',
  'quickCommandRowSizeMultiplier',
  'spreadsheetPreviewRowsPerPage',
  'spreadsheetPreviewMaxColumns',
  'rdpModalWidth',
  'rdpModalHeight',
  'vncModalWidth',
  'vncModalHeight',
]);

const JSON_OBJECT_SETTING_KEYS = new Set<keyof SettingsUpdateRequestDto>(['sidebarPaneWidths', 'fileManagerColWidths']);

const isAllowedSettingKey = (key: string): key is keyof SettingsUpdateRequestDto =>
  ALLOWED_SETTING_KEYS.has(key as keyof SettingsUpdateRequestDto);

const optionalSetting = <K extends keyof SettingsResponseDto>(
  key: K,
  value: SettingsResponseDto[K] | undefined,
): Partial<Pick<SettingsResponseDto, K>> =>
  value === undefined ? {} : ({ [key]: value } as Partial<Pick<SettingsResponseDto, K>>);

const storedBoolean = (settings: Record<string, string>, key: string): boolean | undefined =>
  settings[key] === undefined ? undefined : settings[key] === 'true';

const storedNumber = (settings: Record<string, string>, key: string): number | undefined => {
  if (settings[key] === undefined) return undefined;
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : undefined;
};

const storedRecord = <T extends string | number>(
  settings: Record<string, string>,
  key: string,
  isValue: (value: unknown) => value is T,
): Record<string, T> | undefined => {
  const raw = settings[key];
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || !Object.values(value).every(isValue)) return undefined;
    return value as Record<string, T>;
  } catch {
    return undefined;
  }
};

const settingsDto = (settings: Record<string, string>): SettingsResponseDto => {
  const frontendLogLevel = settings.frontendLogLevel;
  const backendLogLevel = settings.backendLogLevel;
  const commandInputSyncTarget = settings.commandInputSyncTarget;
  return {
    ...optionalSetting('language', settings.language),
    ...optionalSetting('frontendLogLevel', isLogLevel(frontendLogLevel) ? frontendLogLevel : undefined),
    ...optionalSetting('backendLogLevel', isLogLevel(backendLogLevel) ? backendLogLevel : undefined),
    ...optionalSetting('ipWhitelist', settings.ipWhitelist),
    ...optionalSetting('maxLoginAttempts', storedNumber(settings, 'maxLoginAttempts')),
    ...optionalSetting('loginBanDuration', storedNumber(settings, 'loginBanDuration')),
    ...optionalSetting('showPopupFileEditor', storedBoolean(settings, 'showPopupFileEditor')),
    ...optionalSetting('shareFileEditorTabs', storedBoolean(settings, 'shareFileEditorTabs')),
    ...optionalSetting('dockerStatusIntervalSeconds', storedNumber(settings, 'dockerStatusIntervalSeconds')),
    ...optionalSetting('dockerDefaultExpand', storedBoolean(settings, 'dockerDefaultExpand')),
    ...optionalSetting('statusMonitorIntervalSeconds', storedNumber(settings, 'statusMonitorIntervalSeconds')),
    ...optionalSetting('remoteHostRefreshIntervalSeconds', storedNumber(settings, 'remoteHostRefreshIntervalSeconds')),
    ...optionalSetting('statusMonitorScale', storedNumber(settings, 'statusMonitorScale')),
    ...optionalSetting('dashboardShowLocalResources', storedBoolean(settings, 'dashboardShowLocalResources')),
    ...optionalSetting('dashboardShowRemoteResources', storedBoolean(settings, 'dashboardShowRemoteResources')),
    ...optionalSetting('workspaceSidebarPersistent', storedBoolean(settings, 'workspaceSidebarPersistent')),
    ...optionalSetting('showPopupFileManager', storedBoolean(settings, 'showPopupFileManager')),
    ...optionalSetting(
      'sidebarPaneWidths',
      storedRecord(settings, 'sidebarPaneWidths', (value): value is string => typeof value === 'string'),
    ),
    ...optionalSetting('fileManagerRowSizeMultiplier', storedNumber(settings, 'fileManagerRowSizeMultiplier')),
    ...optionalSetting(
      'fileManagerColWidths',
      storedRecord(
        settings,
        'fileManagerColWidths',
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      ),
    ),
    ...optionalSetting(
      'commandInputSyncTarget',
      commandInputSyncTarget === 'none' ||
        commandInputSyncTarget === 'quickCommands' ||
        commandInputSyncTarget === 'commandHistory'
        ? commandInputSyncTarget
        : undefined,
    ),
    ...optionalSetting('timezone', settings.timezone),
    ...optionalSetting('rdpModalWidth', storedNumber(settings, 'rdpModalWidth')),
    ...optionalSetting('rdpModalHeight', storedNumber(settings, 'rdpModalHeight')),
    ...optionalSetting('vncModalWidth', storedNumber(settings, 'vncModalWidth')),
    ...optionalSetting('vncModalHeight', storedNumber(settings, 'vncModalHeight')),
    ...optionalSetting('ipBlacklistEnabled', storedBoolean(settings, 'ipBlacklistEnabled')),
    ...optionalSetting('layoutLocked', storedBoolean(settings, 'layoutLocked')),
    ...optionalSetting('terminalScrollbackLimit', storedNumber(settings, 'terminalScrollbackLimit')),
    ...optionalSetting('spreadsheetPreviewRowsPerPage', storedNumber(settings, 'spreadsheetPreviewRowsPerPage')),
    ...optionalSetting('spreadsheetPreviewMaxColumns', storedNumber(settings, 'spreadsheetPreviewMaxColumns')),
    ...optionalSetting(
      'fileManagerShowDeleteConfirmation',
      storedBoolean(settings, 'fileManagerShowDeleteConfirmation'),
    ),
    ...optionalSetting('terminalRightClickCopyPaste', storedBoolean(settings, 'terminalRightClickCopyPaste')),
    ...optionalSetting('showStatusMonitorIpAddress', storedBoolean(settings, 'showStatusMonitorIpAddress')),
    ...optionalSetting('quickCommandsCollapsibleSearch', storedBoolean(settings, 'quickCommandsCollapsibleSearch')),
    ...optionalSetting('quickCommandsCompactMode', storedBoolean(settings, 'quickCommandsCompactMode')),
    ...optionalSetting('quickCommandRowSizeMultiplier', storedNumber(settings, 'quickCommandRowSizeMultiplier')),
    ...optionalSetting('navBarVisible', storedBoolean(settings, 'navBarVisible')),
    ...optionalSetting('showConnectionTags', storedBoolean(settings, 'showConnectionTags')),
    ...optionalSetting('showQuickCommandTags', storedBoolean(settings, 'showQuickCommandTags')),
  };
};

const storedSettingValue = (key: keyof SettingsUpdateRequestDto, value: unknown): string => {
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    if (typeof value !== 'boolean') throw new Error(`设置 ${key} 必须是布尔值`);
    return String(value);
  }
  if (NUMBER_SETTING_KEYS.has(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`设置 ${key} 必须是有限数字`);
    return String(value);
  }
  if (JSON_OBJECT_SETTING_KEYS.has(key)) {
    if (!isRecord(value)) throw new Error(`设置 ${key} 必须是对象`);
    if (key === 'sidebarPaneWidths' && !Object.values(value).every((width) => typeof width === 'string'))
      throw new Error('sidebarPaneWidths 的值必须是字符串');
    if (
      key === 'fileManagerColWidths' &&
      !Object.values(value).every((width) => typeof width === 'number' && Number.isFinite(width))
    )
      throw new Error('fileManagerColWidths 的值必须是有限数字');
    return JSON.stringify(value);
  }
  if (typeof value !== 'string') throw new Error(`设置 ${key} 必须是字符串`);
  if ((key === 'frontendLogLevel' || key === 'backendLogLevel') && !isLogLevel(value))
    throw new Error(`设置 ${key} 的日志等级无效`);
  if (key === 'commandInputSyncTarget' && !['none', 'quickCommands', 'commandHistory'].includes(value))
    throw new Error('commandInputSyncTarget 无效');
  return value;
};

const publicCaptcha = async (settings: SettingsService): Promise<CaptchaConfigDto> => {
  const value = await settings.getCaptchaConfig();
  return {
    enabled: value.enabled,
    provider: value.provider,
    hcaptchaSiteKey: value.hcaptchaSiteKey,
    recaptchaSiteKey: value.recaptchaSiteKey,
  };
};

const WORKSPACE_PANE_NAMES: ReadonlySet<WorkspacePaneNameDto> = new Set([
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

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw new Error('VALIDATION_FAILED');
};

const workspacePaneName = (value: unknown): WorkspacePaneNameDto => {
  if (typeof value !== 'string' || !WORKSPACE_PANE_NAMES.has(value as WorkspacePaneNameDto)) {
    throw new Error('VALIDATION_FAILED');
  }
  return value as WorkspacePaneNameDto;
};

const workspaceFocusConfigInput = (value: unknown): WorkspaceFocusConfigDto => {
  if (!isRecord(value) || !Array.isArray(value.sequence) || !isRecord(value.shortcuts)) {
    throw new Error('VALIDATION_FAILED');
  }
  onlyKeys(value, ['sequence', 'shortcuts']);
  if (value.sequence.some((entry) => typeof entry !== 'string')) throw new Error('VALIDATION_FAILED');
  const shortcuts: WorkspaceFocusConfigDto['shortcuts'] = {};
  for (const [id, candidate] of Object.entries(value.shortcuts)) {
    if (!isRecord(candidate)) throw new Error('VALIDATION_FAILED');
    onlyKeys(candidate, ['shortcut']);
    if (candidate.shortcut !== undefined && typeof candidate.shortcut !== 'string') {
      throw new Error('VALIDATION_FAILED');
    }
    shortcuts[id] = candidate.shortcut === undefined ? {} : { shortcut: candidate.shortcut };
  }
  return { sequence: [...value.sequence] as string[], shortcuts };
};

const workspaceLayoutNodeInput = (value: unknown, depth = 0): WorkspaceLayoutNodeDto => {
  if (!isRecord(value) || depth > 12) throw new Error('VALIDATION_FAILED');
  onlyKeys(value, ['id', 'type', 'component', 'direction', 'children', 'size']);
  if (value.id !== undefined && (typeof value.id !== 'string' || !value.id)) throw new Error('VALIDATION_FAILED');
  if (value.size !== undefined && (typeof value.size !== 'number' || !Number.isFinite(value.size))) {
    throw new Error('VALIDATION_FAILED');
  }

  if (value.type === 'pane') {
    const component = workspacePaneName(value.component);
    if (value.children !== undefined) throw new Error('VALIDATION_FAILED');
    return {
      ...(value.id === undefined ? {} : { id: value.id }),
      type: 'pane',
      component,
      ...(value.size === undefined ? {} : { size: value.size }),
    };
  }

  if (value.type !== 'container' || (value.direction !== 'horizontal' && value.direction !== 'vertical')) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!Array.isArray(value.children)) throw new Error('VALIDATION_FAILED');
  return {
    ...(value.id === undefined ? {} : { id: value.id }),
    type: 'container',
    direction: value.direction,
    children: value.children.map((child) => workspaceLayoutNodeInput(child, depth + 1)),
    ...(value.size === undefined ? {} : { size: value.size }),
  };
};

const workspaceSidebarConfigInput = (value: unknown): WorkspaceSidebarConfigDto => {
  if (!isRecord(value) || !Array.isArray(value.left) || !Array.isArray(value.right)) {
    throw new Error('VALIDATION_FAILED');
  }
  onlyKeys(value, ['left', 'right']);
  const left = value.left.map(workspacePaneName);
  const right = value.right.map(workspacePaneName);
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) {
    throw new Error('VALIDATION_FAILED');
  }
  if (new Set([...left, ...right]).size !== left.length + right.length) {
    throw new Error('VALIDATION_FAILED');
  }
  return { left, right };
};

const workspaceLayoutSettingsInput = (value: unknown): WorkspaceLayoutSettingsRequestDto => {
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  onlyKeys(value, ['layout', 'sidebar']);
  return {
    layout: workspaceLayoutNodeInput(value.layout),
    sidebar: workspaceSidebarConfigInput(value.sidebar),
  };
};

const captchaConfigUpdateInput = (value: unknown): CaptchaConfigUpdateDto => {
  if (!isRecord(value)) throw new Error('VALIDATION_FAILED');
  onlyKeys(value, [
    'enabled',
    'provider',
    'hcaptchaSiteKey',
    'hcaptchaSecretKey',
    'recaptchaSiteKey',
    'recaptchaSecretKey',
  ]);
  if (
    typeof value.enabled !== 'boolean' ||
    (value.provider !== 'none' && value.provider !== 'hcaptcha' && value.provider !== 'recaptcha')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const hcaptchaSiteKey = value.hcaptchaSiteKey;
  const hcaptchaSecretKey = value.hcaptchaSecretKey;
  const recaptchaSiteKey = value.recaptchaSiteKey;
  const recaptchaSecretKey = value.recaptchaSecretKey;
  for (const field of [hcaptchaSiteKey, hcaptchaSecretKey, recaptchaSiteKey, recaptchaSecretKey]) {
    if (field !== undefined && typeof field !== 'string') throw new Error('VALIDATION_FAILED');
  }
  return {
    enabled: value.enabled,
    provider: value.provider,
    ...(typeof hcaptchaSiteKey === 'string' ? { hcaptchaSiteKey } : {}),
    ...(typeof hcaptchaSecretKey === 'string' ? { hcaptchaSecretKey } : {}),
    ...(typeof recaptchaSiteKey === 'string' ? { recaptchaSiteKey } : {}),
    ...(typeof recaptchaSecretKey === 'string' ? { recaptchaSecretKey } : {}),
  };
};

export const createSettingsRouter = (dependencies: SettingsRouterDependencies): Router => {
  const router = Router();

  router.get(
    '/captcha',
    route(async (_request, response) => {
      response.json(await publicCaptcha(dependencies.settings));
    }),
  );

  router.use(requireAuthenticated);

  router.get(
    '/',
    route(async (_request, response) => {
      response.json(settingsDto(await dependencies.settings.getAllSettings()));
    }),
  );

  router.put(
    '/',
    route(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        response.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
        return;
      }
      const filtered: Record<string, string> = {};
      try {
        const body = request.body as SettingsUpdateRequestDto;
        for (const [key, value] of Object.entries(body)) {
          if (!isAllowedSettingKey(key)) continue;
          filtered[key] = storedSettingValue(key, value);
        }
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
        return;
      }
      for (const [key, bounds] of Object.entries(BOUNDED_INTEGER_SETTINGS)) {
        if (!(key in filtered)) continue;
        const parsed = Number(filtered[key]);
        if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
          response.status(400).json({ message: `设置 ${key} 必须是 ${bounds.min}–${bounds.max} 之间的整数` });
          return;
        }
      }
      for (const [key, bounds] of Object.entries(BOUNDED_NUMBER_SETTINGS)) {
        if (!(key in filtered)) continue;
        const parsed = Number(filtered[key]);
        if (parsed < bounds.min || parsed > bounds.max) {
          response.status(400).json({ message: `设置 ${key} 必须是 ${bounds.min}–${bounds.max} 之间的数字` });
          return;
        }
      }
      if (Object.keys(filtered).length) await dependencies.settings.setMultipleSettings(filtered);
      const updatedKeys = Object.keys(filtered);
      if (updatedKeys.length) {
        if (updatedKeys.includes('ipWhitelist')) {
          await dependencies.audit.logAction('IP_WHITELIST_UPDATED', { updatedKeys });
        } else {
          await dependencies.audit.logAction('SETTINGS_UPDATED', { updatedKeys });
          await dependencies.notifications.publish('SETTINGS_UPDATED', { updatedKeys });
        }
      }
      response.json({ message: '设置已成功更新' });
    }),
  );

  router.get(
    '/focus-switcher-sequence',
    route(async (_request, response) => {
      response.json(await dependencies.settings.getFocusSwitcherSequence());
    }),
  );
  router.put(
    '/focus-switcher-sequence',
    route(async (request, response) => {
      try {
        const input = workspaceFocusConfigInput(request.body);
        await dependencies.settings.setFocusSwitcherSequence(input);
        response.json({ message: '焦点切换顺序已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  router.get(
    '/layout',
    route(async (_request, response) => {
      const raw = await dependencies.settings.getLayoutTree();
      if (!raw) {
        response.json(null);
        return;
      }
      try {
        response.json(workspaceLayoutNodeInput(JSON.parse(raw) as unknown));
      } catch {
        response.status(500).json({ message: '获取布局树失败：存储的数据格式无效' });
      }
    }),
  );
  router.put(
    '/layout',
    route(async (request, response) => {
      let input: WorkspaceLayoutNodeDto;
      try {
        input = workspaceLayoutNodeInput(request.body);
      } catch {
        response.status(400).json({ message: '无效的请求体，应为有效的布局树' });
        return;
      }
      await dependencies.settings.setLayoutTree(JSON.stringify(input));
      response.json({ message: '布局树已成功更新' });
    }),
  );

  router.put(
    '/workspace-layout',
    route(async (request, response) => {
      try {
        const input = workspaceLayoutSettingsInput(request.body);
        await dependencies.settings.setWorkspaceLayoutConfig(JSON.stringify(input.layout), input.sidebar);
        response.json({ message: 'Workspace 布局与侧栏配置已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  router.get(
    '/ip-blacklist',
    route(async (request, response) => {
      const limit = Number.parseInt(typeof request.query.limit === 'string' ? request.query.limit : '50', 10);
      const offset = Number.parseInt(typeof request.query.offset === 'string' ? request.query.offset : '0', 10);
      if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(offset) || offset < 0) {
        response.status(400).json({ message: '无效的分页参数' });
        return;
      }
      const payload: IpBlacklistPageDto = await dependencies.ipBlacklist.getBlacklist(limit, offset);
      response.json(payload);
    }),
  );
  router.delete(
    '/ip-blacklist/:ip',
    route(async (request, response) => {
      const ip = String(request.params.ip || '');
      if (!ip) {
        response.status(400).json({ message: '缺少要删除的 IP 地址' });
        return;
      }
      await dependencies.ipBlacklist.removeFromBlacklist(ip);
      response.json({ message: `IP 地址 ${ip} 已从黑名单中移除` });
    }),
  );

  router.get(
    '/sidebar',
    route(async (_request, response) => {
      response.json(await dependencies.settings.getSidebarConfig());
    }),
  );
  router.put(
    '/sidebar',
    route(async (request, response) => {
      try {
        const input = workspaceSidebarConfigInput(request.body);
        await dependencies.settings.setSidebarConfig(input);
        response.json({ message: '侧栏配置已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  router.put(
    '/captcha',
    route(async (request, response) => {
      try {
        const input = captchaConfigUpdateInput(request.body);
        await dependencies.settings.setCaptchaConfig(input);
        await dependencies.audit.logAction('CAPTCHA_SETTINGS_UPDATED', { updatedFields: Object.keys(input) });
        response.json({ message: 'CAPTCHA 配置已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  router.post(
    '/backup/export',
    route(async (request, response) => {
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!password) {
        response.status(400).json({ message: '请输入当前登录密码后再导出备份。' });
        return;
      }
      try {
        const bytes = await dependencies.backup.exportFull(request.session.userId!, password);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        response.setHeader('Content-Type', 'application/octet-stream');
        response.setHeader('Content-Disposition', `attachment; filename="nexus-terminal-backup-${stamp}.nexus-backup"`);
        response.send(Buffer.from(bytes));
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('密码不正确') || message.includes('请输入') ? 400 : 500).json({ message });
      }
    }),
  );
  router.post(
    '/backup/import',
    backupUpload.single('backupFile'),
    route(async (request, response) => {
      if (!request.file?.buffer) {
        response.status(400).json({ message: '请选择 Nexus Terminal 备份文件。' });
        return;
      }
      const password =
        typeof request.body?.password === 'string' && request.body.password ? request.body.password : undefined;
      try {
        const result = await dependencies.backup.importFull(request.file.buffer, password);
        response.json({ message: '备份导入成功。', ...result });
      } catch (error) {
        if (error instanceof BackupPasswordRequiredError) {
          response.status(400).json({ code: error.code, message: error.message });
          return;
        }
        if (error instanceof InvalidBackupPasswordError) {
          response.status(400).json({ code: error.code, message: error.message });
          return;
        }
        response.status(400).json({ message: errorMessage(error) || '导入完整备份失败。' });
      }
    }),
  );

  return router;
};

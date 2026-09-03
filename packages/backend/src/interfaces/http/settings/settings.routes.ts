import { Router } from 'express';
import multer from 'multer';
import type { BackupService } from '../../../modules/backup/backup.service';
import type { ConnectionExportService } from '../../../modules/connections/connection-export.service';
import { BackupPasswordRequiredError, InvalidBackupPasswordError } from '../../../shared/errors/backup.errors';
import type { AppearanceSettingsService } from '../../../modules/appearance/appearance-settings.service';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { IpBlacklistService } from '../../../modules/auth/ip-blacklist.service';
import type { NotificationService } from '../../../modules/notifications/notification.service';
import type { SettingsService } from '../../../modules/settings/settings.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';
import { fromLegacySettingValue } from '../legacy-api/settings-http.mapper';

export interface SettingsRouterDependencies {
  backup: BackupService;
  connectionExport: ConnectionExportService;
  settings: SettingsService;
  appearance: AppearanceSettingsService;
  ipBlacklist: IpBlacklistService;
  audit: AuditLogService;
  notifications: NotificationService;
}

const ALLOWED_SETTING_KEYS = new Set([
  'language',
  'ipWhitelist',
  'maxLoginAttempts',
  'loginBanDuration',
  'showPopupFileEditor',
  'shareFileEditorTabs',
  'ipWhitelistEnabled',
  'autoCopyOnSelect',
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
  'spreadsheetPreviewMaxRows',
  'spreadsheetPreviewRowsPerPage',
  'spreadsheetPreviewMaxColumns',
  'fileManagerShowDeleteConfirmation',
  'terminalEnableRightClickPaste',
  'showStatusMonitorIpAddress',
  'quickCommandsCollapsibleSearch',
]);

const BOUNDED_INTEGER_SETTINGS: Record<string, { min: number; max: number }> = {
  remoteHostRefreshIntervalSeconds: { min: 1, max: 86400 },
  spreadsheetPreviewMaxRows: { min: 10, max: 2000 },
  spreadsheetPreviewRowsPerPage: { min: 10, max: 2000 },
  spreadsheetPreviewMaxColumns: { min: 5, max: 200 },
};

const publicCaptcha = async (settings: SettingsService) => {
  const value = await settings.getCaptchaConfig();
  return {
    enabled: value.enabled,
    provider: value.provider,
    hcaptchaSiteKey: value.hcaptchaSiteKey,
    recaptchaSiteKey: value.recaptchaSiteKey,
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
      response.json(await dependencies.settings.getAllSettings());
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
      for (const [key, value] of Object.entries(request.body as Record<string, unknown>)) {
        if (!ALLOWED_SETTING_KEYS.has(key)) continue;
        const normalized = fromLegacySettingValue(value);
        if (normalized === null) {
          response.status(400).json({ message: `设置 ${key} 必须是字符串、数字或布尔值` });
          return;
        }
        filtered[key] = normalized;
      }
      for (const [key, bounds] of Object.entries(BOUNDED_INTEGER_SETTINGS)) {
        if (!(key in filtered)) continue;
        const parsed = Number(filtered[key]);
        if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
          response.status(400).json({ message: `设置 ${key} 必须是 ${bounds.min}–${bounds.max} 之间的整数` });
          return;
        }
      }
      if (Object.keys(filtered).length) await dependencies.settings.setMultipleSettings(filtered);
      const updatedKeys = Object.keys(filtered);
      if (updatedKeys.length) {
        if (updatedKeys.includes('ipWhitelist') || updatedKeys.includes('ipWhitelistEnabled')) {
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
    '/appearance',
    route(async (_request, response) => {
      response.json(await dependencies.appearance.get());
    }),
  );
  router.put(
    '/appearance',
    route(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        response.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
        return;
      }
      await dependencies.appearance.update(request.body);
      response.json({ message: '外观设置已成功更新' });
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
        await dependencies.settings.setFocusSwitcherSequence(request.body);
        response.json({ message: '焦点切换顺序已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  router.get(
    '/nav-bar-visibility',
    route(async (_request, response) => {
      response.json({ visible: await dependencies.settings.getNavBarVisibility() });
    }),
  );
  router.put(
    '/nav-bar-visibility',
    route(async (request, response) => {
      if (typeof request.body?.visible !== 'boolean') {
        response.status(400).json({ message: '无效的请求体，"visible" 必须是一个布尔值' });
        return;
      }
      await dependencies.settings.setNavBarVisibility(request.body.visible);
      response.json({ message: '导航栏可见性已成功更新' });
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
        response.json(JSON.parse(raw));
      } catch {
        response.status(500).json({ message: '获取布局树失败：存储的数据格式无效' });
      }
    }),
  );
  router.put(
    '/layout',
    route(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        response.status(400).json({ message: '无效的请求体，应为 JSON 对象格式的布局树' });
        return;
      }
      await dependencies.settings.setLayoutTree(JSON.stringify(request.body));
      response.json({ message: '布局树已成功更新' });
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
      response.json(await dependencies.ipBlacklist.getBlacklist(limit, offset));
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
    '/auto-copy-on-select',
    route(async (_request, response) => {
      response.json({ enabled: await dependencies.settings.getAutoCopyOnSelect() });
    }),
  );
  router.put(
    '/auto-copy-on-select',
    route(async (request, response) => {
      if (typeof request.body?.enabled !== 'boolean') {
        response.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
        return;
      }
      await dependencies.settings.setAutoCopyOnSelect(request.body.enabled);
      response.json({ message: '终端选中自动复制设置已成功更新' });
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
        await dependencies.settings.setSidebarConfig(request.body);
        response.json({ message: '侧栏配置已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  const booleanSetting = (
    path: string,
    getter: () => Promise<boolean>,
    setter: (value: boolean) => Promise<unknown>,
    key: string,
  ) => {
    router.get(
      path,
      route(async (_request, response) => {
        response.json({ enabled: await getter() });
      }),
    );
    router.put(
      path,
      route(async (request, response) => {
        if (typeof request.body?.enabled !== 'boolean') {
          response.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
          return;
        }
        await setter(request.body.enabled);
        await dependencies.audit.logAction('SETTINGS_UPDATED', { updatedKeys: [key] });
        await dependencies.notifications.publish('SETTINGS_UPDATED', { updatedKeys: [key] });
        response.json({ message: `${key} 设置已成功更新` });
      }),
    );
  };

  booleanSetting(
    '/show-connection-tags',
    () => dependencies.settings.getShowConnectionTags(),
    (value) => dependencies.settings.setShowConnectionTags(value),
    'showConnectionTags',
  );
  booleanSetting(
    '/show-quick-command-tags',
    () => dependencies.settings.getShowQuickCommandTags(),
    (value) => dependencies.settings.setShowQuickCommandTags(value),
    'showQuickCommandTags',
  );
  booleanSetting(
    '/show-status-monitor-ip-address',
    () => dependencies.settings.getShowStatusMonitorIpAddress(),
    (value) => dependencies.settings.setShowStatusMonitorIpAddress(value),
    'showStatusMonitorIpAddress',
  );

  router.put(
    '/captcha',
    route(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        response.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
        return;
      }
      try {
        await dependencies.settings.setCaptchaConfig(request.body);
        await dependencies.audit.logAction('CAPTCHA_SETTINGS_UPDATED', { updatedFields: Object.keys(request.body) });
        response.json({ message: 'CAPTCHA 配置已成功更新' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );

  router.get(
    '/export-connections',
    route(async (_request, response) => {
      const bytes = await dependencies.connectionExport.export(true);
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Disposition', 'attachment; filename="nexus_connections_export.zip"');
      response.send(Buffer.from(bytes));
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

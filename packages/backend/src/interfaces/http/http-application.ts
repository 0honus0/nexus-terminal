import express, { type Express, type RequestHandler } from 'express';
import type { CommandHistoryService } from '../../modules/command-history/command-history.service';
import type { FavoritePathService } from '../../modules/favorite-paths/favorite-path.service';
import type { NotificationSettingsService } from '../../modules/notifications/notification-settings.service';
import type { PathHistoryService } from '../../modules/path-history/path-history.service';
import type { ProxyService } from '../../modules/proxies/proxy.service';
import type { QuickCommandTagService } from '../../modules/quick-command-tags/quick-command-tag.service';
import type { QuickCommandService } from '../../modules/quick-commands/quick-command.service';
import type { SshKeyService } from '../../modules/ssh-keys/ssh-key.service';
import type { SshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import type { SshResourceStatusService } from '../../modules/system/ssh-resource-status.service';
import type { SystemStatusService } from '../../modules/system/system-status.service';
import type { TagService } from '../../modules/tags/tag.service';
import type { TerminalThemeService } from '../../modules/terminal-themes/terminal-theme.service';
import type { TransfersService } from '../../modules/transfers/transfers.service';
import type { BackupService } from '../../modules/backup/backup.service';
import type { BackgroundAssetService } from '../../modules/appearance/background-asset.service';
import type { HtmlThemeService } from '../../modules/appearance/html-theme.service';
import type { AppearanceSettingsService } from '../../modules/appearance/appearance-settings.service';
import type { AuditLogService } from '../../modules/audit/audit.service';
import type { AuthService } from '../../modules/auth/auth.service';
import type { CaptchaService } from '../../modules/auth/captcha.service';
import type { IpBlacklistService } from '../../modules/auth/ip-blacklist.service';
import type { IpWhitelistService } from '../../modules/auth/ip-whitelist.service';
import type { TwoFactorService } from '../../modules/auth/two-factor.service';
import type { RemoteDesktopSessionService } from '../../modules/remote-desktop/remote-desktop-session.service';
import type { ConnectionExportService } from '../../modules/connections/connection-export.service';
import type { ConnectionService } from '../../modules/connections/connection.service';
import type { SshConnectionTestService } from '../../modules/connections/services/ssh-connection-test.service';
import type { NotificationService } from '../../modules/notifications/notification.service';
import type { PasskeyService } from '../../modules/passkey/passkey.service';
import type { SettingsService } from '../../modules/settings/settings.service';
import type { SystemHealthService } from '../../modules/system/system-health.service';
import type { UserService } from '../../modules/user/user.service';
import { createAppearanceRouter } from './appearance/appearance.routes';
import { createAuditRouter } from './audit/audit.routes';
import { createCommandHistoryRouter } from './command-history/command-history.routes';
import { createFavoritePathsRouter } from './favorite-paths/favorite-paths.routes';
import { createNotificationsRouter } from './notifications/notifications.routes';
import { createPathHistoryRouter } from './path-history/path-history.routes';
import { createProxiesRouter } from './proxies/proxies.routes';
import { createQuickCommandTagsRouter } from './quick-command-tags/quick-command-tags.routes';
import { createQuickCommandsRouter } from './quick-commands/quick-commands.routes';
import { createSftpRouter } from './sftp/sftp.routes';
import { createSshKeysRouter } from './ssh-keys/ssh-keys.routes';
import { createSshSuspendRouter } from './ssh-suspend/ssh-suspend.routes';
import { createSystemRouter } from './system/system.routes';
import { createTagsRouter } from './tags/tags.routes';
import { createTerminalThemesRouter } from './terminal-themes/terminal-themes.routes';
import { createTransfersRouter } from './transfers/transfers.routes';
import { createIpWhitelistMiddleware } from './security/ip-whitelist.middleware';
import { createAuthRouter } from './auth/auth.routes';
import { createConnectionsRouter } from './connections/connections.routes';
import { createSettingsRouter } from './settings/settings.routes';
import { errorMessage } from './shared/http-utils';

export interface HttpApplicationDependencies {
  sessionMiddleware: RequestHandler;
  trustProxy: string;
  sessionCookieName: string;
  clearSessions(): Promise<void>;
  e2eResetEnabled: boolean;
  resetForE2E(mode: 'seed' | 'empty'): Promise<void>;
  systemHealth: SystemHealthService;
  auth: AuthService;
  twoFactor: TwoFactorService;
  captcha: CaptchaService;
  ipBlacklist: IpBlacklistService;
  ipWhitelist: IpWhitelistService;
  passkeys: PasskeyService;
  backup: BackupService;
  settings: SettingsService;
  users: UserService;
  appearance: AppearanceSettingsService;
  audit: AuditLogService;
  notifications: NotificationService;
  connections: ConnectionService;
  connectionExport: ConnectionExportService;
  sshConnectionTest: SshConnectionTestService;
  remoteDesktop: RemoteDesktopSessionService;
  proxies: ProxyService;
  sshKeys: SshKeyService;
  tags: TagService;
  quickCommandTags: QuickCommandTagService;
  quickCommands: QuickCommandService;
  commandHistory: CommandHistoryService;
  pathHistory: PathHistoryService;
  favoritePaths: FavoritePathService;
  notificationSettings: NotificationSettingsService;
  terminalThemes: TerminalThemeService;
  backgroundAssets: BackgroundAssetService;
  htmlThemes: HtmlThemeService;
  transfers: TransfersService;
  sshSuspend: SshSuspendService;
  systemStatus: SystemStatusService;
  sshResourceStatus: SshResourceStatusService;
  passkeyRelyingParties: readonly { rpId: string; origin: string }[];
  workspaceFilesystem: import('../../modules/workspace/services/workspace-filesystem.service').WorkspaceFilesystemService;
}

export const createHttpApplication = (dependencies: HttpApplicationDependencies): Express => {
  const app = express();
  app.set('trust proxy', dependencies.trustProxy);
  app.disable('x-powered-by');

  app.use(createIpWhitelistMiddleware(dependencies.ipWhitelist));

  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  if (dependencies.e2eResetEnabled) {
    app.post('/api/v1/__e2e/reset', async (request, response) => {
      const mode = request.body?.mode;
      if (mode !== 'seed' && mode !== 'empty') {
        response.status(400).json({ message: 'mode must be "seed" or "empty".' });
        return;
      }
      try {
        await dependencies.resetForE2E(mode);
        await dependencies.clearSessions();
        response.status(204).end();
      } catch (error) {
        response.status(500).json({ message: errorMessage(error) || 'E2E reset failed.' });
      }
    });
  }

  app.use(dependencies.sessionMiddleware);

  app.get('/.well-known/webauthn', (request, response) => {
    const forwardedHost = request.headers['x-forwarded-host'];
    const rawHost = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host;
    const hostname = rawHost?.split(',')[0]?.trim().replace(/:\d+$/, '').toLowerCase();
    if (!hostname) {
      response.status(404).json({ origins: [] });
      return;
    }
    const matched =
      dependencies.passkeyRelyingParties.find((item) => item.rpId.toLowerCase() === hostname) ??
      dependencies.passkeyRelyingParties.find((item) => {
        try {
          return new URL(item.origin).hostname.toLowerCase() === hostname;
        } catch {
          return false;
        }
      });
    if (!matched) {
      response.status(404).json({ origins: [] });
      return;
    }
    const rpId = matched.rpId.toLowerCase();
    const origins = dependencies.passkeyRelyingParties
      .filter((item) => item.rpId.toLowerCase() === rpId)
      .map((item) => item.origin)
      .filter((origin) => {
        try {
          const originHost = new URL(origin).hostname.toLowerCase();
          return originHost !== rpId && !originHost.endsWith(`.${rpId}`);
        } catch {
          return false;
        }
      });
    response.setHeader('Cache-Control', 'public, max-age=300');
    response.json({ origins: [...new Set(origins)] });
  });

  app.use(
    '/api/v1/auth',
    createAuthRouter({
      auth: dependencies.auth,
      twoFactor: dependencies.twoFactor,
      captcha: dependencies.captcha,
      ipBlacklist: dependencies.ipBlacklist,
      passkeys: dependencies.passkeys,
      settings: dependencies.settings,
      users: dependencies.users,
      sessionCookieName: dependencies.sessionCookieName,
    }),
  );
  app.use(
    '/api/v1/settings',
    createSettingsRouter({
      backup: dependencies.backup,
      connectionExport: dependencies.connectionExport,
      settings: dependencies.settings,
      ipBlacklist: dependencies.ipBlacklist,
      audit: dependencies.audit,
      notifications: dependencies.notifications,
    }),
  );
  app.use(
    '/api/v1/connections',
    createConnectionsRouter({
      connections: dependencies.connections,
      connectionExport: dependencies.connectionExport,
      proxies: dependencies.proxies,
      sshConnectionTest: dependencies.sshConnectionTest,
      remoteDesktop: dependencies.remoteDesktop,
    }),
  );

  app.use('/api/v1/proxies', createProxiesRouter({ proxies: dependencies.proxies, audit: dependencies.audit }));
  app.use('/api/v1/ssh-keys', createSshKeysRouter(dependencies.sshKeys));
  app.use('/api/v1/tags', createTagsRouter({ tags: dependencies.tags, audit: dependencies.audit }));
  app.use('/api/v1/quick-command-tags', createQuickCommandTagsRouter(dependencies.quickCommandTags));
  app.use('/api/v1/quick-commands', createQuickCommandsRouter(dependencies.quickCommands));
  app.use('/api/v1/command-history', createCommandHistoryRouter(dependencies.commandHistory));
  app.use('/api/v1/path-history', createPathHistoryRouter(dependencies.pathHistory));
  app.use('/api/v1/favorite-paths', createFavoritePathsRouter(dependencies.favoritePaths));
  app.use('/api/v1/notifications', createNotificationsRouter(dependencies.notificationSettings));
  app.use('/api/v1/audit-logs', createAuditRouter(dependencies.audit));
  app.use('/api/v1/terminal-themes', createTerminalThemesRouter(dependencies.terminalThemes));
  app.use(
    '/api/v1/appearance',
    createAppearanceRouter({
      appearance: dependencies.appearance,
      backgrounds: dependencies.backgroundAssets,
      htmlThemes: dependencies.htmlThemes,
    }),
  );
  app.use('/api/v1/sftp', createSftpRouter(dependencies.workspaceFilesystem));
  app.use('/api/v1/ssh-suspend', createSshSuspendRouter(dependencies.sshSuspend));
  app.use('/api/v1/transfers', createTransfersRouter(dependencies.transfers));
  app.use(
    '/api/v1/system',
    createSystemRouter({ systemStatus: dependencies.systemStatus, sshResourceStatus: dependencies.sshResourceStatus }),
  );

  app.get('/api/v1/status', (_request, response) => {
    response.json(dependencies.systemHealth.get());
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (response.headersSent) return;
    console.error('[HTTP] Unhandled route error:', error);
    response.status(500).json({ message: 'Internal server error.', error: errorMessage(error) });
  });

  return app;
};

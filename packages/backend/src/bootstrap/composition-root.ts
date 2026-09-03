import path from 'node:path';
import type { RuntimeConfig } from '../config/runtime-config';
import { NexusBackupCodecAdapter } from '../infrastructure/backup/backup-codec.adapter';
import { SqliteBackupSnapshotAdapter } from '../infrastructure/backup/sqlite-backup-snapshot.adapter';
import { ZipConnectionExportAdapter } from '../infrastructure/backup/zip-connection-export.adapter';
import { GitHubHtmlThemeCatalogAdapter } from '../infrastructure/appearance/github-html-theme-catalog.adapter';
import { LocalBackgroundAssetAdapter } from '../infrastructure/appearance/local-background-asset.adapter';
import { LocalHtmlThemeStoreAdapter } from '../infrastructure/appearance/local-html-theme-store.adapter';
import { ZipDirectoryArchiveAdapter } from '../infrastructure/archive/zip-directory-archive.adapter';
import { NetworkCaptchaVerifierAdapter } from '../infrastructure/auth/network-captcha-verifier.adapter';
import { SimpleWebAuthnAdapter } from '../infrastructure/auth/simple-webauthn.adapter';
import { SpeakeasyTwoFactorAdapter } from '../infrastructure/auth/speakeasy-two-factor.adapter';
import { DatabaseAdapter } from '../infrastructure/database/database.adapter';
import { SqliteAppearanceSettingsRepository } from '../infrastructure/database/repositories/sqlite-appearance-settings.repository';
import { SqliteAuditLogRepository } from '../infrastructure/database/repositories/sqlite-audit-log.repository';
import { SqliteCommandHistoryRepository } from '../infrastructure/database/repositories/sqlite-command-history.repository';
import { SqliteConnectionRepository } from '../infrastructure/database/repositories/sqlite-connection.repository';
import { SqliteFavoritePathRepository } from '../infrastructure/database/repositories/sqlite-favorite-path.repository';
import { SqliteIpBlacklistRepository } from '../infrastructure/database/repositories/sqlite-ip-blacklist.repository';
import { SqliteNotificationRepository } from '../infrastructure/database/repositories/sqlite-notification.repository';
import { SqlitePasskeyRepository } from '../infrastructure/database/repositories/sqlite-passkey.repository';
import { SqlitePathHistoryRepository } from '../infrastructure/database/repositories/sqlite-path-history.repository';
import { SqliteProxyRepository } from '../infrastructure/database/repositories/sqlite-proxy.repository';
import { SqliteQuickCommandRepository } from '../infrastructure/database/repositories/sqlite-quick-command.repository';
import { SqliteQuickCommandTagRepository } from '../infrastructure/database/repositories/sqlite-quick-command-tag.repository';
import { SqliteSettingsRepository } from '../infrastructure/database/repositories/sqlite-settings.repository';
import { SqliteSshKeyRepository } from '../infrastructure/database/repositories/sqlite-ssh-key.repository';
import { SqliteTagRepository } from '../infrastructure/database/repositories/sqlite-tag.repository';
import { SqliteTerminalThemeRepository } from '../infrastructure/database/repositories/sqlite-terminal-theme.repository';
import { SqliteUserRepository } from '../infrastructure/database/repositories/sqlite-user.repository';
import { DatabaseDiagnosticProbe } from '../infrastructure/diagnostics/database-diagnostic.probe';
import { ProcessDiagnosticProbe } from '../infrastructure/diagnostics/process-diagnostic.probe';
import { GuacamoleAdapter } from '../infrastructure/guacamole/guacamole.adapter';
import { NetworkNotificationChannelAdapter } from '../infrastructure/notifications/network-notification-channel.adapter';
import { AesGcmSecretCipher } from '../infrastructure/security/aes-gcm-secret-cipher';
import { BcryptPasswordHasher } from '../infrastructure/security/bcrypt-password-hasher';
import { SshTransportAdapter } from '../infrastructure/ssh/ssh-transport.adapter';
import { LocalSuspendedSessionLogAdapter } from '../infrastructure/ssh-suspend/local-suspended-session-log.adapter';
import { NodeLocalSystemStatusAdapter } from '../infrastructure/system/node-local-system-status.adapter';
import { BackupService } from '../modules/backup/backup.service';
import { AppearanceSettingsService } from '../modules/appearance/appearance-settings.service';
import { BackgroundAssetService } from '../modules/appearance/background-asset.service';
import { HtmlThemeService } from '../modules/appearance/html-theme.service';
import { AuditLogService } from '../modules/audit/audit.service';
import { AuthService } from '../modules/auth/auth.service';
import { CaptchaService } from '../modules/auth/captcha.service';
import { IpBlacklistService } from '../modules/auth/ip-blacklist.service';
import { IpWhitelistService } from '../modules/auth/ip-whitelist.service';
import { TwoFactorService } from '../modules/auth/two-factor.service';
import { CommandHistoryService } from '../modules/command-history/command-history.service';
import { ConnectionCredentialService } from '../modules/connections/connection-credential.service';
import { ConnectionExportService } from '../modules/connections/connection-export.service';
import { ConnectionService } from '../modules/connections/connection.service';
import { SshConnectionResolver } from '../modules/connections/services/ssh-connection-resolver.service';
import { SshConnectionTestService } from '../modules/connections/services/ssh-connection-test.service';
import { FavoritePathService } from '../modules/favorite-paths/favorite-path.service';
import { NotificationFormatter } from '../modules/notifications/notification-formatter.service';
import { NotificationSettingsService } from '../modules/notifications/notification-settings.service';
import { NotificationService } from '../modules/notifications/notification.service';
import { RemoteDesktopSessionService } from '../modules/remote-desktop/remote-desktop-session.service';
import { PasskeyService } from '../modules/passkey/passkey.service';
import { PathHistoryService } from '../modules/path-history/path-history.service';
import { ProxyService } from '../modules/proxies/proxy.service';
import { QuickCommandTagService } from '../modules/quick-command-tags/quick-command-tag.service';
import { QuickCommandService } from '../modules/quick-commands/quick-command.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SshKeyService } from '../modules/ssh-keys/ssh-key.service';
import { SshSuspendService } from '../modules/ssh-suspend/ssh-suspend.service';
import { SshResourceStatusService } from '../modules/system/ssh-resource-status.service';
import {
  SystemDiagnosticsService,
  type DiagnosticsService,
} from '../modules/system/diagnostics/system-diagnostics.service';
import { SystemHealthService } from '../modules/system/system-health.service';
import { SystemStatusService } from '../modules/system/system-status.service';
import { TagService } from '../modules/tags/tag.service';
import { presetTerminalThemes } from '../modules/terminal-themes/preset-themes-definition';
import { TerminalThemeService } from '../modules/terminal-themes/terminal-theme.service';
import { TransferOrchestratorService } from '../modules/transfers/transfer-orchestrator.service';
import { TransferTaskRegistry } from '../modules/transfers/transfer-task.registry';
import { TransfersService } from '../modules/transfers/transfers.service';
import { UserService } from '../modules/user/user.service';
import { WorkspaceEventHub } from '../modules/workspace/workspace-event-hub';
import { WorkspaceSessionRegistry } from '../modules/workspace/workspace-session-registry';
import { WorkspaceService } from '../modules/workspace/workspace.service';
import { WorkspaceCommandService } from '../modules/workspace/services/workspace-command.service';
import { WorkspaceDockerService } from '../modules/workspace/services/workspace-docker.service';
import { WorkspaceFilesystemService } from '../modules/workspace/services/workspace-filesystem.service';
import { WorkspaceOperationsService } from '../modules/workspace/services/workspace-operations.service';
import { WorkspaceShellIntegrationService } from '../modules/workspace/services/workspace-shell-integration.service';
import { WorkspaceStatusMonitorService } from '../modules/workspace/services/workspace-status-monitor.service';
import { WorkspaceSuspendCoordinatorService } from '../modules/workspace/services/workspace-suspend-coordinator.service';
import { WorkspaceTerminalService } from '../modules/workspace/services/workspace-terminal.service';
import { RemoteDockerService } from '../platform/docker/remote-docker.service';
import { ExecutionSessionDiagnosticProbe } from '../platform/execution/diagnostics/execution-session-diagnostic.probe';
import { ExecutionSessionManager } from '../platform/execution/execution-session-manager';
import { FileRemovalService } from '../platform/filesystem/file-removal.service';
import { RemoteFileSearchService } from '../platform/filesystem/remote-file-search.service';
import { RemoteTextFileService } from '../platform/filesystem/remote-text-file.service';
import type { DirectoryArchivePort } from '../platform/operations/archive/directory-archive.port';
import { RemoteArchiveOperationService } from '../platform/operations/archive/remote-archive-operation.service';
import type { ArchiveOperation } from '../platform/operations/archive/archive-operation.port';
import { ServerTransferExecutor } from '../platform/operations/transfer/server-transfer-executor';
import { StreamTransferOperationService } from '../platform/operations/transfer/stream-transfer-operation.service';
import type { TransferOperation } from '../platform/operations/transfer/transfer-operation.port';
import { StreamUploadOperationService } from '../platform/operations/upload/stream-upload-operation.service';
import type { UploadOperation } from '../platform/operations/upload/upload-operation.port';
import { PosixServerStatusCollector } from '../platform/system/posix-server-status.collector';
import type { ServerStatusCollector } from '../platform/system/server-status.port';

export interface PlatformServices {
  executionSessions: ExecutionSessionManager;
  textFiles: RemoteTextFileService;
  fileSearch: RemoteFileSearchService;
  fileRemoval: FileRemovalService;
  uploads: UploadOperation;
  transfers: TransferOperation;
  archives: ArchiveOperation;
  directoryArchives: DirectoryArchivePort;
  serverTransfers: ServerTransferExecutor;
  serverStatus: ServerStatusCollector;
  docker: RemoteDockerService;
}

export interface ModuleServices {
  backup: BackupService;
  settings: SettingsService;
  audit: AuditLogService;
  notifications: NotificationService;
  notificationSettings: NotificationSettingsService;
  user: UserService;
  auth: AuthService;
  twoFactor: TwoFactorService;
  captcha: CaptchaService;
  ipBlacklist: IpBlacklistService;
  ipWhitelist: IpWhitelistService;
  passkeys: PasskeyService;
  sshKeys: SshKeyService;
  proxies: ProxyService;
  connections: ConnectionService;
  connectionExport: ConnectionExportService;
  sshResolver: SshConnectionResolver;
  sshConnectionTest: SshConnectionTestService;
  remoteDesktop: RemoteDesktopSessionService;
  tags: TagService;
  quickCommandTags: QuickCommandTagService;
  quickCommands: QuickCommandService;
  commandHistory: CommandHistoryService;
  pathHistory: PathHistoryService;
  favoritePaths: FavoritePathService;
  terminalThemes: TerminalThemeService;
  appearance: AppearanceSettingsService;
  backgroundAssets: BackgroundAssetService;
  htmlThemes: HtmlThemeService;
  transfers: TransfersService;
  transferTasks: TransferTaskRegistry;
  sshSuspend: SshSuspendService;
  systemHealth: SystemHealthService;
  systemStatus: SystemStatusService;
  sshResourceStatus: SshResourceStatusService;
  diagnostics: DiagnosticsService;
  workspace: WorkspaceService;
  workspaceSessions: WorkspaceSessionRegistry;
  workspaceEvents: WorkspaceEventHub;
  workspaceCommand: WorkspaceCommandService;
  workspaceTerminal: WorkspaceTerminalService;
  workspaceShell: WorkspaceShellIntegrationService;
  workspaceFilesystem: WorkspaceFilesystemService;
  workspaceOperations: WorkspaceOperationsService;
  workspaceStatus: WorkspaceStatusMonitorService;
  workspaceDocker: WorkspaceDockerService;
  workspaceSuspend: WorkspaceSuspendCoordinatorService;
}

export interface CompositionRoot {
  platform: PlatformServices;
  modules: ModuleServices;
  initialize(): Promise<void>;
  resetForE2E(mode: 'seed' | 'empty'): Promise<void>;
  dispose(): Promise<void>;
}

/** Explicit application graph. Concrete Infrastructure objects never escape this factory. */
export const createCompositionRoot = (config: RuntimeConfig): CompositionRoot => {
  const database = new DatabaseAdapter({
    dataDirectory: config.dataDirectory,
    nodeEnv: config.nodeEnv,
    e2eResetEnabled: config.e2eResetEnabled,
  });
  const cipher = new AesGcmSecretCipher(config.encryptionKeyHex);
  const passwordHasher = new BcryptPasswordHasher();

  const settingsRepository = new SqliteSettingsRepository(database);
  const auditRepository = new SqliteAuditLogRepository(database);
  const userRepository = new SqliteUserRepository(database);
  const sshKeyRepository = new SqliteSshKeyRepository(database);
  const proxyRepository = new SqliteProxyRepository(database);
  const connectionRepository = new SqliteConnectionRepository(database);
  const tagRepository = new SqliteTagRepository(database);
  const quickCommandTagRepository = new SqliteQuickCommandTagRepository(database);
  const quickCommandRepository = new SqliteQuickCommandRepository(database);
  const commandHistoryRepository = new SqliteCommandHistoryRepository(database);
  const pathHistoryRepository = new SqlitePathHistoryRepository(database);
  const favoritePathRepository = new SqliteFavoritePathRepository(database);
  const notificationRepository = new SqliteNotificationRepository(database);
  const passkeyRepository = new SqlitePasskeyRepository(database);
  const terminalThemeRepository = new SqliteTerminalThemeRepository(database);
  const appearanceRepository = new SqliteAppearanceSettingsRepository(database);
  const blacklistRepository = new SqliteIpBlacklistRepository(database);

  const settings = new SettingsService(settingsRepository);
  const audit = new AuditLogService(auditRepository);
  const notificationChannels = new NetworkNotificationChannelAdapter();
  const notificationFormatter = new NotificationFormatter();
  const notifications = new NotificationService(
    notificationRepository,
    notificationChannels,
    notificationFormatter,
    settings,
  );
  const notificationSettings = new NotificationSettingsService(
    notificationRepository,
    notificationChannels,
    audit,
    notifications,
  );
  const user = new UserService(userRepository);
  const sshKeys = new SshKeyService(sshKeyRepository, cipher);
  const proxies = new ProxyService(proxyRepository, cipher);
  const credentials = new ConnectionCredentialService(cipher, sshKeys);
  const connections = new ConnectionService(connectionRepository, credentials, audit);

  let connectedHookService: ConnectionService | undefined = connections;
  const sshTransport = new SshTransportAdapter({
    onConnected: async (connection) => {
      await connectedHookService?.markConnected(connection.connectionId);
    },
  });
  const executionSessions = new ExecutionSessionManager(sshTransport);
  const sshResolver = new SshConnectionResolver(connectionRepository, credentials, proxies);
  const sshConnectionTest = new SshConnectionTestService(sshResolver, sshTransport);
  const remoteDesktop = new RemoteDesktopSessionService(
    connections,
    new GuacamoleAdapter({ apiBaseUrl: config.remoteGatewayApiBase, sharedSecret: config.remoteGatewaySharedSecret }),
  );

  const auth = new AuthService(user, passwordHasher, audit, notifications);
  const twoFactor = new TwoFactorService(
    user,
    new SpeakeasyTwoFactorAdapter(),
    passwordHasher,
    auth,
    audit,
    notifications,
  );
  const captcha = new CaptchaService(settings, new NetworkCaptchaVerifierAdapter());
  const ipBlacklist = new IpBlacklistService(blacklistRepository, settings, notifications);
  const ipWhitelist = new IpWhitelistService(settings);
  const webauthn = new SimpleWebAuthnAdapter({ appName: config.appName, relyingParties: config.passkeyRelyingParties });
  const passkeys = new PasskeyService(passkeyRepository, user, webauthn, audit, notifications);

  const tags = new TagService(tagRepository);
  const connectionExport = new ConnectionExportService(
    connections,
    tags,
    sshKeys,
    new ZipConnectionExportAdapter(config.encryptionKeyHex),
  );
  const quickCommandTags = new QuickCommandTagService(quickCommandTagRepository);
  const quickCommands = new QuickCommandService(quickCommandRepository, quickCommandTagRepository);
  const commandHistory = new CommandHistoryService(commandHistoryRepository);
  const pathHistory = new PathHistoryService(pathHistoryRepository);
  const favoritePaths = new FavoritePathService(favoritePathRepository);

  const terminalThemes = new TerminalThemeService(terminalThemeRepository);
  const backgroundStore = new LocalBackgroundAssetAdapter(config.dataDirectory);
  const appearance = new AppearanceSettingsService(appearanceRepository, terminalThemes, backgroundStore);
  const backgroundAssets = new BackgroundAssetService(backgroundStore, appearance);
  const htmlStore = new LocalHtmlThemeStoreAdapter({
    presetDirectory: path.resolve(__dirname, '../../html-presets'),
    dataDirectory: config.dataDirectory,
  });
  const htmlThemes = new HtmlThemeService(htmlStore, new GitHubHtmlThemeCatalogAdapter(), appearance);

  const textFiles = new RemoteTextFileService();
  const fileSearch = new RemoteFileSearchService();
  const fileRemoval = new FileRemovalService();
  const uploads = new StreamUploadOperationService(executionSessions);
  const fileTransfers = new StreamTransferOperationService(executionSessions);
  const archives = new RemoteArchiveOperationService(executionSessions);
  const directoryArchives = new ZipDirectoryArchiveAdapter();
  const serverTransfers = new ServerTransferExecutor(sshTransport);
  const serverStatus = new PosixServerStatusCollector();
  const docker = new RemoteDockerService();

  const transferTasks = new TransferTaskRegistry();
  const transferOrchestrator = new TransferOrchestratorService(
    transferTasks,
    sshResolver,
    executionSessions,
    serverTransfers,
  );
  const transfers = new TransfersService(transferTasks, transferOrchestrator);

  const suspendedLogs = new LocalSuspendedSessionLogAdapter(config.dataDirectory);
  const sshSuspend = new SshSuspendService(suspendedLogs);

  const workspaceSessions = new WorkspaceSessionRegistry();
  const workspaceEvents = new WorkspaceEventHub();
  const workspace = new WorkspaceService(
    workspaceSessions,
    executionSessions,
    sshResolver,
    connections,
    audit,
    notifications,
  );
  const workspaceShell = new WorkspaceShellIntegrationService(workspaceSessions, executionSessions, workspaceEvents);
  const workspaceTerminal = new WorkspaceTerminalService(workspaceSessions, workspaceShell, workspaceEvents);
  const workspaceCommand = new WorkspaceCommandService(workspaceSessions, workspaceShell);
  const workspaceFilesystem = new WorkspaceFilesystemService(
    workspaceSessions,
    executionSessions,
    textFiles,
    fileSearch,
    fileRemoval,
    directoryArchives,
    workspaceEvents,
  );
  const workspaceOperations = new WorkspaceOperationsService(
    workspaceSessions,
    uploads,
    fileTransfers,
    archives,
    workspaceEvents,
  );
  const workspaceStatus = new WorkspaceStatusMonitorService(
    workspaceSessions,
    executionSessions,
    settings,
    serverStatus,
    workspaceEvents,
  );
  const workspaceDocker = new WorkspaceDockerService(workspaceSessions, executionSessions, docker);
  const workspaceSuspend = new WorkspaceSuspendCoordinatorService(
    workspace,
    workspaceTerminal,
    workspaceShell,
    workspaceStatus,
    workspaceOperations,
    workspaceFilesystem,
    sshSuspend,
    suspendedLogs,
    workspaceEvents,
  );

  const systemHealth = new SystemHealthService();
  const systemStatus = new SystemStatusService(new NodeLocalSystemStatusAdapter());
  const sshResourceStatus = new SshResourceStatusService(
    connections,
    sshResolver,
    executionSessions,
    serverStatus,
    settings,
  );
  const backup = new BackupService(
    new SqliteBackupSnapshotAdapter(database, cipher, config.dataDirectory),
    new NexusBackupCodecAdapter(config.encryptionKeyHex),
    user,
    passwordHasher,
    {
      beforeRestore: async () => {
        transferTasks.cancelAll();
        await workspaceSuspend.dispose().catch(() => undefined);
        await sshSuspend.dispose().catch(() => undefined);
        await executionSessions.closeAll();
      },
      afterRestore: async () => {
        await settings.ensureDefaults();
        await terminalThemes.initialize(presetTerminalThemes);
        await appearance.initialize();
        sshResourceStatus.clearCache();
      },
    },
  );

  const diagnostics = new SystemDiagnosticsService([
    new ProcessDiagnosticProbe(),
    new DatabaseDiagnosticProbe(database),
    new ExecutionSessionDiagnosticProbe(executionSessions),
  ]);

  const modules: ModuleServices = {
    backup,
    settings,
    audit,
    notifications,
    notificationSettings,
    user,
    auth,
    twoFactor,
    captcha,
    ipBlacklist,
    ipWhitelist,
    passkeys,
    sshKeys,
    proxies,
    connections,
    connectionExport,
    sshResolver,
    sshConnectionTest,
    remoteDesktop,
    tags,
    quickCommandTags,
    quickCommands,
    commandHistory,
    pathHistory,
    favoritePaths,
    terminalThemes,
    appearance,
    backgroundAssets,
    htmlThemes,
    transfers,
    transferTasks,
    sshSuspend,
    systemHealth,
    systemStatus,
    sshResourceStatus,
    diagnostics,
    workspace,
    workspaceSessions,
    workspaceEvents,
    workspaceCommand,
    workspaceTerminal,
    workspaceShell,
    workspaceFilesystem,
    workspaceOperations,
    workspaceStatus,
    workspaceDocker,
    workspaceSuspend,
  };
  const platform: PlatformServices = {
    executionSessions,
    textFiles,
    fileSearch,
    fileRemoval,
    uploads,
    transfers: fileTransfers,
    archives,
    directoryArchives,
    serverTransfers,
    serverStatus,
    docker,
  };

  return {
    platform,
    modules,
    initialize: async () => {
      await database.initialize();
      await settings.ensureDefaults();
      await terminalThemes.initialize(presetTerminalThemes);
      await appearance.initialize();
    },
    resetForE2E: async (mode) => {
      transferTasks.cancelAll();
      await workspaceSuspend.dispose().catch(() => undefined);
      await sshSuspend.dispose().catch(() => undefined);
      await executionSessions.closeAll();
      await database.resetForE2E(mode, config.e2eSeedDatabase);
      await settings.ensureDefaults();
      await terminalThemes.initialize(presetTerminalThemes);
      await appearance.initialize();
      sshResourceStatus.clearCache();
    },
    dispose: async () => {
      transferTasks.cancelAll();
      connectedHookService = undefined;
      await workspaceSuspend.dispose().catch(() => undefined);
      await sshSuspend.dispose().catch(() => undefined);
      await executionSessions.closeAll();
      await database.close();
    },
  };
};

import http, { type Server } from 'node:http';
import type { RuntimeConfig } from '../config/runtime-config';
import { FileHttpSessionAdapter } from '../infrastructure/session/file-http-session.adapter';
import { createHttpApplication } from '../interfaces/http/http-application';
import { attachWebSocketServer } from '../interfaces/websocket/websocket-server';
import { createCompositionRoot, type CompositionRoot } from './composition-root';

export interface BackendApplication {
  readonly server: Server;
  readonly services: CompositionRoot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createBackendApplication = (config: RuntimeConfig): BackendApplication => {
  const services = createCompositionRoot(config);
  const sessions = new FileHttpSessionAdapter({
    dataDirectory: config.dataDirectory,
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
  });
  const httpApplication = createHttpApplication({
    sessionMiddleware: sessions.middleware,
    trustProxy: config.trustProxy,
    sessionCookieName: sessions.cookieName,
    clearSessions: () => sessions.clear(),
    e2eResetEnabled: config.nodeEnv === 'test' && config.e2eResetEnabled,
    resetForE2E: (mode) => services.resetForE2E(mode),
    systemHealth: services.modules.systemHealth,
    auth: services.modules.auth,
    twoFactor: services.modules.twoFactor,
    captcha: services.modules.captcha,
    ipBlacklist: services.modules.ipBlacklist,
    ipWhitelist: services.modules.ipWhitelist,
    passkeys: services.modules.passkeys,
    backup: services.modules.backup,
    settings: services.modules.settings,
    users: services.modules.user,
    appearance: services.modules.appearance,
    audit: services.modules.audit,
    notifications: services.modules.notifications,
    connections: services.modules.connections,
    connectionExport: services.modules.connectionExport,
    sshConnectionTest: services.modules.sshConnectionTest,
    remoteDesktop: services.modules.remoteDesktop,
    proxies: services.modules.proxies,
    sshKeys: services.modules.sshKeys,
    tags: services.modules.tags,
    quickCommandTags: services.modules.quickCommandTags,
    quickCommands: services.modules.quickCommands,
    commandHistory: services.modules.commandHistory,
    pathHistory: services.modules.pathHistory,
    favoritePaths: services.modules.favoritePaths,
    notificationSettings: services.modules.notificationSettings,
    terminalThemes: services.modules.terminalThemes,
    backgroundAssets: services.modules.backgroundAssets,
    htmlThemes: services.modules.htmlThemes,
    transfers: services.modules.transfers,
    sshSuspend: services.modules.sshSuspend,
    systemStatus: services.modules.systemStatus,
    sshResourceStatus: services.modules.sshResourceStatus,
    passkeyRelyingParties: config.passkeyRelyingParties,
    workspaceFilesystem: services.modules.workspaceFilesystem,
  });
  const server = http.createServer(httpApplication);
  const webSockets = attachWebSocketServer({
    server,
    sessionMiddleware: sessions.middleware,
    config: {
      remoteGatewayWsBaseUrl: config.remoteGatewayWsBaseUrl,
      allowOriginlessWebSockets: config.allowOriginlessWebSockets,
      passkeyRelyingParties: config.passkeyRelyingParties,
    },
    dependencies: {
      ipWhitelist: services.modules.ipWhitelist,
      workspace: services.modules.workspace,
      events: services.modules.workspaceEvents,
      terminal: services.modules.workspaceTerminal,
      command: services.modules.workspaceCommand,
      shell: services.modules.workspaceShell,
      filesystem: services.modules.workspaceFilesystem,
      operations: services.modules.workspaceOperations,
      status: services.modules.workspaceStatus,
      docker: services.modules.workspaceDocker,
      suspendCoordinator: services.modules.workspaceSuspend,
      suspended: services.modules.sshSuspend,
    },
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  return {
    server,
    services,
    start: async () => {
      await services.initialize();
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => reject(error);
          server.once('error', onError);
          server.listen(config.port, config.host, () => {
            server.off('error', onError);
            resolve();
          });
        });
      } catch (error) {
        await webSockets.close().catch(() => undefined);
        await services.dispose();
        throw error;
      }
    },
    stop: async () => {
      try {
        await webSockets.close();
        await new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await services.dispose();
      }
    },
  };
};

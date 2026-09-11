import http, { type Server } from 'node:http';
import type { RuntimeConfig } from '../config/runtime-config';
import { GuacamoleRuntimeAdapter } from '../infrastructure/guacamole/guacamole-runtime.adapter';
import { FileHttpSessionAdapter } from '../infrastructure/session/file-http-session.adapter';
import { createPluginFrontendStaticServer } from '../infrastructure/agent/plugins/plugin-frontend-static-server';
import { createHttpApplication } from '../interfaces/http/http-application';
import { attachWebSocketServer, type BackendWebSocketServer } from '../interfaces/websocket/websocket-server';
import { createCompositionRoot, type CompositionRoot } from './composition-root';
import { startRuntimePerformanceReporter, type RuntimePerformanceReporter } from './runtime-performance-reporter';

export interface BackendApplication {
  readonly server: Server;
  readonly services: CompositionRoot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const createBackendApplication = (config: RuntimeConfig): BackendApplication => {
  const guacamoleRuntime = new GuacamoleRuntimeAdapter({ guacdHost: config.guacdHost, guacdPort: config.guacdPort });
  const services = createCompositionRoot(config, { remoteDesktopSessionIssuer: guacamoleRuntime });
  const sessions = new FileHttpSessionAdapter({
    dataDirectory: config.dataDirectory,
    secret: config.sessionSecret,
    cookieName: config.sessionCookieName,
  });
  let webSockets!: BackendWebSocketServer;
  let performanceReporter: RuntimePerformanceReporter | undefined;
  const httpApplication = createHttpApplication({
    sessionMiddleware: sessions.middleware,
    trustProxy: config.trustProxy,
    sessionCookieName: sessions.cookieName,
    nodeEnv: config.nodeEnv,
    agentPublicOrigin: config.agentPublicOrigin,
    agentCsrfSecret: config.sessionSecret,
    agent: services.agent.host,
    agentPlugins: services.agent.plugins,
    agentProviders: services.agent.ai.providers,
    agentIntegrations: services.agent.ai.integrations,
    agentArtifacts: services.agent.ai.artifacts,
    agentApprovals: services.agent.runtime.approvals,
    agentConversations: services.agent.ai.conversations,
    agentRuns: services.agent.runtime.runs,
    agentCollaboration: services.agent.runtime.collaboration,
    agentMemories: services.agent.ai.memories,
    agentEvents: services.agent.runtime.events,
    agentWorkspaceRuntime: services.agent.runtime.workspaceRuntime,
    e2eResetEnabled: config.nodeEnv === 'test' && config.e2eResetEnabled,
    resetForE2E: (mode) =>
      webSockets.quiesce(async () => {
        await services.resetForE2E(mode);
        await sessions.clear();
      }),
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
    connectionImport: services.modules.connectionImport,
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
  if (config.agentPluginFrontendOrigin && !config.agentPublicOrigin) {
    throw new Error('PLUGIN_FRONTEND_PUBLIC_ORIGIN_REQUIRED');
  }
  if (config.agentPluginFrontendOrigin && config.agentPluginFrontendOrigin === config.agentPublicOrigin) {
    throw new Error('PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED');
  }
  const pluginFrontendServer = config.agentPluginFrontendOrigin
    ? createPluginFrontendStaticServer({
        dataDirectory: config.dataDirectory,
        publicOrigin: config.agentPublicOrigin!,
      })
    : undefined;
  webSockets = attachWebSocketServer({
    server,
    sessionMiddleware: sessions.middleware,
    config: {
      allowOriginlessWebSockets: config.allowOriginlessWebSockets,
      passkeyRelyingParties: config.passkeyRelyingParties,
    },
    dependencies: {
      ipWhitelist: services.modules.ipWhitelist,
      remoteDesktop: {
        accept: (socket, request, ticket, userId) => guacamoleRuntime.acceptSession(ticket, userId, socket, request),
      },
      agentEvents: services.agent.runtime.events,
      agentRuns: services.agent.runtime.runs,
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
      performanceReporter = startRuntimePerformanceReporter({
        webSockets: () => webSockets.metrics(),
        activeExecutionSessions: () => services.platform.executionSessions.snapshot().length,
        activeWorkspaceSessions: () => services.modules.workspaceSessions.snapshot().length,
        transfers: () => services.modules.transferTasks.metrics(),
      });
      try {
        const listen = (target: Server, port: number): Promise<void> =>
          new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            target.once('error', onError);
            target.listen(port, config.host, () => {
              target.off('error', onError);
              resolve();
            });
          });
        await listen(server, config.port);
        if (pluginFrontendServer) await listen(pluginFrontendServer, config.agentPluginFrontendPort);
      } catch (error) {
        performanceReporter?.stop();
        performanceReporter = undefined;
        await webSockets.close().catch(() => undefined);
        if (pluginFrontendServer?.listening) {
          await new Promise<void>((resolve) => pluginFrontendServer.close(() => resolve()));
        }
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        guacamoleRuntime.close();
        await services.dispose();
        throw error;
      }
    },
    stop: async () => {
      performanceReporter?.stop();
      performanceReporter = undefined;
      try {
        await services.agent.quiesce(Math.floor(Date.now() / 1000) + 10).catch(() => undefined);
        await webSockets.close();
        if (pluginFrontendServer?.listening) {
          await new Promise<void>((resolve, reject) =>
            pluginFrontendServer.close((error) => (error ? reject(error) : resolve())),
          );
        }
        await new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        guacamoleRuntime.close();
        await services.dispose();
      }
    },
  };
};

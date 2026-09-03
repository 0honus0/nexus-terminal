import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseAdapter } from '../infrastructure/database/database.adapter';
import { DatabaseDiagnosticProbe } from '../infrastructure/diagnostics/database-diagnostic.probe';
import { ProcessDiagnosticProbe } from '../infrastructure/diagnostics/process-diagnostic.probe';
import { NodeApplicationEventBus } from '../infrastructure/events/node-application-event-bus';
import { GuacamoleAdapter } from '../infrastructure/guacamole/guacamole.adapter';
import { AesGcmSecretCipher } from '../infrastructure/security/aes-gcm-secret-cipher';
import { BcryptPasswordHasher } from '../infrastructure/security/bcrypt-password-hasher';
import { NodeSecureTokenGenerator } from '../infrastructure/security/node-secure-token-generator';
import { SshTransportAdapter } from '../infrastructure/ssh/ssh-transport.adapter';
import { SystemDiagnosticsService, type DiagnosticsService } from '../modules/system/diagnostics/system-diagnostics.service';
import { SystemHealthService } from '../modules/system/system-health.service';
import { TransferTaskRegistry } from '../modules/transfers/transfer-task.service';
import { WorkspaceSessionRegistry } from '../modules/workspace/workspace-session-registry';
import { WorkspaceService } from '../modules/workspace/workspace.service';
import { ExecutionSessionManager } from '../platform/execution/execution-session-manager';
import { ExecutionSessionDiagnosticProbe } from '../platform/execution/diagnostics/execution-session-diagnostic.probe';

export interface PlatformServices {
  executionSessions: ExecutionSessionManager;
}

export interface ModuleServices {
  systemHealth: SystemHealthService;
  diagnostics: DiagnosticsService;
  workspace: WorkspaceService;
  workspaceSessions: WorkspaceSessionRegistry;
  transferTasks: TransferTaskRegistry;
}

/**
 * Explicit public application graph. Infrastructure objects intentionally stay private to this factory.
 * Future Agent modules receive Platform/Module contracts from here, never concrete adapters or credentials.
 */
export interface CompositionRoot {
  platform: PlatformServices;
  modules: ModuleServices;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

export const createCompositionRoot = (config: RuntimeConfig): CompositionRoot => {
  const database = new DatabaseAdapter({
    dataDirectory: config.dataDirectory,
    nodeEnv: config.nodeEnv,
    e2eResetEnabled: config.e2eResetEnabled,
  });
  const secretCipher = new AesGcmSecretCipher(config.encryptionKeyHex);
  const passwordHasher = new BcryptPasswordHasher();
  const tokenGenerator = new NodeSecureTokenGenerator();
  const eventBus = new NodeApplicationEventBus();
  const remoteDesktopGateway = new GuacamoleAdapter();
  void secretCipher;
  void passwordHasher;
  void tokenGenerator;
  void eventBus;
  void remoteDesktopGateway;

  const sshTransport = new SshTransportAdapter();
  const executionSessions = new ExecutionSessionManager(sshTransport);
  const workspaceSessions = new WorkspaceSessionRegistry();
  const workspace = new WorkspaceService(workspaceSessions, executionSessions);
  const transferTasks = new TransferTaskRegistry();
  const diagnostics = new SystemDiagnosticsService([
    new ProcessDiagnosticProbe(),
    new DatabaseDiagnosticProbe(database),
    new ExecutionSessionDiagnosticProbe(executionSessions),
  ]);
  const systemHealth = new SystemHealthService();

  return {
    platform: { executionSessions },
    modules: {
      systemHealth,
      diagnostics,
      workspace,
      workspaceSessions,
      transferTasks,
    },
    initialize: async () => {
      await database.initialize();
    },
    dispose: async () => {
      await executionSessions.closeAll();
      await database.close();
    },
  };
};

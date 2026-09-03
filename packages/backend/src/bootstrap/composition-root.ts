import { DatabaseAdapter } from '../infrastructure/database/database.adapter';
import { ProcessDiagnosticProbe } from '../infrastructure/diagnostics/process-diagnostic.probe';
import { GuacamoleAdapter } from '../infrastructure/guacamole/guacamole.adapter';
import { SshTransportAdapter } from '../infrastructure/ssh/ssh-transport.adapter';
import { SystemDiagnosticsService, type DiagnosticsService } from '../modules/system/diagnostics/system-diagnostics.service';
import { SystemHealthService } from '../modules/system/system-health.service';
import { TransferTaskRegistry } from '../modules/transfers/transfer-task.service';
import { WorkspaceSessionRegistry } from '../modules/workspace/workspace-session-registry';
import { WorkspaceService } from '../modules/workspace/workspace.service';
import { ExecutionSessionManager } from '../platform/execution/execution-session-manager';
import type { RelationalDatabase } from '../platform/storage/relational-database.port';
import type { RemoteDesktopGateway } from '../platform/remote-desktop/remote-desktop-gateway.port';

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

export interface InfrastructureServices {
  database: RelationalDatabase;
  remoteDesktopGateway: RemoteDesktopGateway;
}

/**
 * Explicit application graph. Future modules, including Agent runtime, receive capabilities from here;
 * they never discover global singletons or import Bootstrap from business code.
 */
export interface CompositionRoot {
  platform: PlatformServices;
  modules: ModuleServices;
  infrastructure: InfrastructureServices;
  dispose(): Promise<void>;
}

export const createCompositionRoot = (): CompositionRoot => {
  const database = new DatabaseAdapter();
  const sshTransport = new SshTransportAdapter();
  const executionSessions = new ExecutionSessionManager(sshTransport);
  const workspaceSessions = new WorkspaceSessionRegistry();
  const workspace = new WorkspaceService(workspaceSessions, executionSessions);
  const transferTasks = new TransferTaskRegistry();
  const diagnostics = new SystemDiagnosticsService([
    new ProcessDiagnosticProbe(),
  ]);
  const systemHealth = new SystemHealthService();
  const remoteDesktopGateway = new GuacamoleAdapter();

  return {
    platform: { executionSessions },
    modules: {
      systemHealth,
      diagnostics,
      workspace,
      workspaceSessions,
      transferTasks,
    },
    infrastructure: {
      database,
      remoteDesktopGateway,
    },
    dispose: async () => {
      await executionSessions.closeAll();
      await database.close();
    },
  };
};

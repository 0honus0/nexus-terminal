import type { WorkspaceSessionRegistry } from '../workspace-session-registry';
import type { WorkspaceShellIntegrationService } from './workspace-shell-integration.service';

/** User-visible command-like Workspace actions that are safe to expose independently of terminal input. */
export class WorkspaceCommandService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly shellIntegration: WorkspaceShellIntegrationService,
  ) {}

  async readCurrentDirectory(workspaceId: string, userId: number): Promise<string> {
    const session = this.sessions.require(workspaceId);
    if (session.userId !== userId) throw new Error('无权访问此 Workspace。');
    return this.shellIntegration.readCurrentPath(workspaceId);
  }
}

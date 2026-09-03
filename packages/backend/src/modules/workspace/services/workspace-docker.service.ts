import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import type { DockerCommand } from '../../../platform/docker/docker.port';
import type { RemoteDockerService } from '../../../platform/docker/remote-docker.service';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';
export class WorkspaceDockerService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executions: ExecutionSessionManager,
    private readonly docker: RemoteDockerService,
  ) {}
  getStatus(workspaceId: string) {
    return this.docker.getStatus(this.execution(workspaceId));
  }
  command(workspaceId: string, containerId: string, command: DockerCommand) {
    return this.docker.executeCommand(this.execution(workspaceId), containerId, command);
  }
  getStats(workspaceId: string, containerId: string) {
    return this.docker.getStats(this.execution(workspaceId), containerId);
  }
  private execution(id: string) {
    const workspace = this.sessions.require(id);
    return this.executions.require(workspace.executionSessionId);
  }
}

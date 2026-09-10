import { randomUUID } from 'node:crypto';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import type { DockerCommand } from '../../../platform/docker/docker.port';
import type { RemoteDockerService } from '../../../platform/docker/remote-docker.service';
import type { MutationGuardPort } from '../../../platform/operations/mutation-guard.port';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

export class WorkspaceDockerService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executions: ExecutionSessionManager,
    private readonly docker: RemoteDockerService,
    private readonly mutationGuard: MutationGuardPort,
  ) {}

  getStatus(workspaceId: string) {
    return this.docker.getStatus(this.execution(workspaceId));
  }

  command(workspaceId: string, containerId: string, command: DockerCommand) {
    const workspace = this.sessions.require(workspaceId);
    return this.mutationGuard.withMutation(
      {
        ownerType: 'workspace',
        ownerId: workspaceId,
        operationId: `docker.${command}:${randomUUID()}`,
        resourceKeys: [
          `connection:${workspace.connectionId}`,
          `connection:${workspace.connectionId}:docker:${containerId}`,
        ],
        timeoutSeconds: command === 'stop' ? 45 : 30,
      },
      async () => this.docker.executeCommand(this.execution(workspaceId), containerId, command),
    );
  }

  getStats(workspaceId: string, containerId: string) {
    return this.docker.getStats(this.execution(workspaceId), containerId);
  }

  private execution(id: string) {
    const workspace = this.sessions.require(id);
    return this.executions.require(workspace.executionSessionId);
  }
}

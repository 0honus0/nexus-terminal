import type {
  AgentDiagnosticReport,
  AgentDiagnosticsPort,
  DockerMutationInspection,
  DockerMutationResult,
  MachineCapabilityPort,
} from '../../../modules/agent/capabilities/machine.port';
import type { AgentConnectionResolverPort } from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { TargetDenylistRepositoryPort } from '../../../modules/agent/host/target-denylist.repository.port';
import type { RemoteDockerService } from '../../../platform/docker/remote-docker.service';
import type { ExecutionSession } from '../../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';

const MAX_PROBES = 32;
const MAX_PROBE_ID_LENGTH = 128;

const assertDeadline = (context: ToolContext): void => {
  if (context.signal.aborted) throw new DOMException('Agent machine operation aborted.', 'AbortError');
  if (Math.floor(Date.now() / 1000) >= context.deadlineAt) throw new Error('TOOL_TIMEOUT');
};

const assertConnectionSelected = (context: ToolContext, connectionId: number): void => {
  if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
};

export class MachineCapabilityAdapter implements MachineCapabilityPort {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly diagnostics: AgentDiagnosticsPort,
    private readonly sessions: ExecutionSessionManager,
    private readonly docker: RemoteDockerService,
    private readonly denylist: TargetDenylistRepositoryPort,
  ) {}

  async listConnections(context: ToolContext) {
    const denied = new Set((await this.denylist.list()).map((entry) => entry.connectionId));
    const selected = new Set(context.connectionIds);
    return (await this.connections.list())
      .filter((connection) => connection.type === 'SSH' && selected.has(connection.id) && !denied.has(connection.id))
      .map((connection) => ({
        id: connection.id,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        username: connection.username,
      }));
  }

  async diagnose(
    context: ToolContext,
    connectionId: number,
    probeIds: readonly string[],
    actorId: string,
    signal: AbortSignal,
  ): Promise<AgentDiagnosticReport> {
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    assertConnectionSelected(context, connectionId);
    if (
      !Array.isArray(probeIds) ||
      probeIds.length > MAX_PROBES ||
      probeIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > MAX_PROBE_ID_LENGTH)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (signal.aborted) throw new DOMException('Agent diagnostics aborted.', 'AbortError');
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    return this.diagnostics.run(connectionId, [...new Set(probeIds)], actorId);
  }

  async inspectDockerContainer(
    context: ToolContext,
    connectionId: number,
    containerId: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationInspection> {
    if (!/^[a-fA-F0-9]{12,64}$/.test(containerId)) throw new Error('VALIDATION_FAILED');
    return this.withSession(
      context,
      connectionId,
      async (session) => this.inspectDockerWithSession(session, containerId),
      expectedConfigurationHash,
    );
  }

  async mutateDockerContainer(
    context: ToolContext,
    connectionId: number,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'remove',
    expectedState: string,
    expectedConfigurationHash: string,
  ): Promise<DockerMutationResult> {
    if (!['start', 'stop', 'restart', 'remove'].includes(action) || !expectedState || expectedState.length > 64) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const before = await this.inspectDockerWithSession(session, containerId);
        if (before.state !== expectedState) throw new Error('RESOURCE_CHANGED');
        await this.docker.executeCommand(session, before.containerId, action);
        assertDeadline(context);
        if (action === 'remove') {
          const status = await this.docker.getStatus(session);
          const remains = status.containers.some((candidate) => candidate.id === before.containerId);
          if (remains) throw new Error('VERIFICATION_FAILED');
          return { ...before, action, confirmed: true };
        }
        const after = await this.inspectDockerWithSession(session, before.containerId);
        const expectedAfter = action === 'stop' ? 'exited' : 'running';
        if (after.state !== expectedAfter) throw new Error('VERIFICATION_FAILED');
        return { ...after, action, confirmed: true };
      },
      expectedConfigurationHash,
    );
  }

  private async inspectDockerWithSession(
    session: ExecutionSession,
    containerId: string,
  ): Promise<DockerMutationInspection> {
    const status = await this.docker.getStatus(session);
    if (!status.available) throw new Error('DOCKER_UNAVAILABLE');
    const matches = status.containers.filter(
      (candidate) => candidate.id === containerId || candidate.id.startsWith(containerId),
    );
    if (matches.length !== 1) throw new Error(matches.length === 0 ? 'NOT_FOUND' : 'VALIDATION_FAILED');
    const container = matches[0]!;
    return { containerId: container.id, state: container.State, image: container.ImageID || container.Image };
  }

  private async withSession<T>(
    context: ToolContext,
    connectionId: number,
    work: (session: ExecutionSession) => Promise<T>,
    expectedConfigurationHash?: string,
  ): Promise<T> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    assertConnectionSelected(context, connectionId);
    const safe = await this.connections.get(connectionId);
    if (!safe || safe.type !== 'SSH') throw new Error('NOT_FOUND');
    if (expectedConfigurationHash !== undefined && safe.configurationHash !== expectedConfigurationHash) {
      throw new Error('RESOURCE_CHANGED');
    }
    const resolved = await this.connections.resolve(connectionId, expectedConfigurationHash);
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.agentRuntimeId,
      connection: resolved,
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertDeadline(context);
      return await work(session);
    } finally {
      await this.sessions.close(session.id).catch(() => undefined);
    }
  }
}

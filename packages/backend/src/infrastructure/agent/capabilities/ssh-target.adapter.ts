import { createHash } from 'node:crypto';
import type {
  AgentConnectionResolverPort,
  SshTargetFingerprint,
  SshTargetResolverPort,
} from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { TargetDenylistRepositoryPort } from '../../../modules/agent/host/target-denylist.repository.port';

const assertConnectionSelected = (context: ToolContext, connectionId: number): void => {
  if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
};

export class SshTargetAdapter implements SshTargetResolverPort {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly denylist: TargetDenylistRepositoryPort,
  ) {}

  async target(context: ToolContext, connectionId: number): Promise<SshTargetFingerprint> {
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    assertConnectionSelected(context, connectionId);
    if (await this.denylist.isDenied(connectionId)) throw new Error('TARGET_DENIED');
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    const endpoint = `${connection.host.trim().toLowerCase()}:${connection.port}`;
    const targetIdentity = createHash('sha256')
      .update(`${endpoint}\n${connection.username}\n${connection.configurationHash}`, 'utf8')
      .digest('hex');
    return {
      kind: 'ssh',
      target: 'ssh',
      id: String(connectionId),
      connectionId,
      targetIdentity,
      endpoint,
      loginUser: connection.username,
      configurationHash: connection.configurationHash,
      hostKeyTrust: 'unavailable',
    };
  }
}

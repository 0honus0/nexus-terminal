import { createHash } from 'node:crypto';
import type { AgentConnectionResolverPort, AgentDiagnosticsPort } from '../../modules/agent/capabilities/machine.port';
import type { ConnectionService } from '../../modules/connections/connection.service';
import type { Connection } from '../../modules/connections/connection.types';
import type { SshConnectionResolver } from '../../modules/connections/services/ssh-connection-resolver.service';
import type { DiagnosticsService } from '../../modules/system/diagnostics/system-diagnostics.service';

const stableConnectionHash = (connection: {
  id: number;
  type: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  proxyId: number | null;
  route: string | null;
  jumpChain: number[] | null;
  updatedAt: number;
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: connection.id,
        type: connection.type,
        host: connection.host.trim().toLowerCase(),
        port: connection.port,
        username: connection.username,
        authMethod: connection.authMethod,
        proxyId: connection.proxyId,
        route: connection.route,
        jumpChain: connection.jumpChain ?? [],
        updatedAt: connection.updatedAt,
      }),
      'utf8',
    )
    .digest('hex');

export const createAgentConnectionResolver = (
  connections: ConnectionService,
  sshResolver: SshConnectionResolver,
): AgentConnectionResolverPort => {
  const view = (connection: Connection) => ({
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    updatedAt: connection.updatedAt,
    configurationHash: stableConnectionHash(connection),
  });

  return {
    list: async () => (await connections.list()).map((connection) => view(connection)),
    get: async (connectionId) => {
      const connection = await connections.get(connectionId);
      return connection ? view(connection) : null;
    },
    resolve: (connectionId) => sshResolver.resolveStored(connectionId),
  };
};

export const createAgentDiagnostics = (diagnostics: DiagnosticsService): AgentDiagnosticsPort => ({
  run: async (connectionId, probeIds, actorId) => {
    const report = await diagnostics.run({
      actorType: 'agent',
      actorId,
      probeIds,
      subject: { kind: 'connection', id: String(connectionId) },
    });
    return {
      generatedAt: report.generatedAt,
      observations: report.observations.map(
        (observation) => JSON.parse(JSON.stringify(observation)) as Record<string, string | number | boolean | null>,
      ),
    };
  },
});

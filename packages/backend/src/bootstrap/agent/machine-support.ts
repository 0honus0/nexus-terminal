import type { AgentDiagnosticsPort } from '../../modules/agent/capabilities/machine.port';
import type { AgentConnectionResolverPort } from '../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ConnectionService } from '../../modules/connections/connection.service';
import type { Connection } from '../../modules/connections/connection.types';
import type { SshConnectionResolver } from '../../modules/connections/services/ssh-connection-resolver.service';
import type { DiagnosticsService } from '../../modules/system/diagnostics/system-diagnostics.service';

export const createAgentConnectionResolver = (
  connections: ConnectionService,
  sshResolver: SshConnectionResolver,
): AgentConnectionResolverPort => {
  const view = async (connection: Connection) => ({
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    updatedAt: connection.updatedAt,
    configurationHash:
      connection.type === 'SSH'
        ? await sshResolver.fingerprintStored(connection.id)
        : `non-ssh:${connection.id}:${connection.updatedAt}`,
  });

  return {
    list: async () => Promise.all((await connections.list()).map((connection) => view(connection))),
    get: async (connectionId) => {
      const connection = await connections.get(connectionId);
      return connection ? view(connection) : null;
    },
    resolve: async (connectionId, expectedConfigurationHash) => {
      if (!expectedConfigurationHash) return sshResolver.resolveStored(connectionId);
      const before = await sshResolver.fingerprintStored(connectionId);
      if (before !== expectedConfigurationHash) throw new Error('RESOURCE_CHANGED');
      const resolved = await sshResolver.resolveStored(connectionId);
      const after = await sshResolver.fingerprintStored(connectionId);
      if (after !== expectedConfigurationHash) throw new Error('RESOURCE_CHANGED');
      return resolved;
    },
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

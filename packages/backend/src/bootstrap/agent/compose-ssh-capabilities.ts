import { SshFileTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-file-target.adapter';
import { SshShellTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-shell-target.adapter';
import { SshTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-target.adapter';
import { AgentSshSessions } from '../../infrastructure/agent/capabilities/agent-ssh-sessions';
import { AgentProjectDirectories } from '../../infrastructure/agent/capabilities/agent-project-directories';
import type { SqliteConversationRepository } from '../../infrastructure/agent/repositories/sqlite-conversation.repository';
import type { SqliteTargetDenylistRepository } from '../../infrastructure/agent/repositories/sqlite-target-denylist.repository';
import type { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import type { AgentConnectionResolverPort } from '../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';

interface ComposeSshCapabilitiesOptions {
  database: RelationalDatabase;
  connectionResolver: AgentConnectionResolverPort;
  executionSessions: ExecutionSessionManager;
  targetDenylist: SqliteTargetDenylistRepository;
  conversationRepository: SqliteConversationRepository;
  capabilityBroker: AppCapabilityBroker;
}

/** Construction only; the root retains session initialization, quiesce and disposal ordering. */
export const composeSshCapabilities = ({
  database,
  connectionResolver,
  executionSessions,
  targetDenylist,
  conversationRepository,
  capabilityBroker,
}: ComposeSshCapabilitiesOptions) => {
  const sshTargets = new SshTargetAdapter(connectionResolver, targetDenylist);
  const sshSessions = new AgentSshSessions(
    connectionResolver,
    executionSessions,
    database,
    async (scope, threadId, connectionId) => {
      const thread = await conversationRepository.getThread(scope, threadId);
      const decision = await capabilityBroker.authorize(scope, 'shell.execute', {
        target: { target: 'ssh', id: String(connectionId) },
      });
      return Boolean(thread && decision.allowed);
    },
  );
  const sshFiles = new SshFileTargetAdapter(connectionResolver, sshSessions);
  const projectDirectories = new AgentProjectDirectories(database, sshFiles, async (context, connectionId) => {
    await sshTargets.target(context, connectionId);
    const thread = context.threadId ? await conversationRepository.getThread(context, context.threadId) : null;
    const decision = await capabilityBroker.authorize(context, 'file.read', {
      target: { target: 'ssh', id: String(connectionId) },
    });
    return Boolean(thread && decision.allowed);
  });
  const sshShell = new SshShellTargetAdapter(connectionResolver, sshSessions);
  return { sshTargets, sshSessions, sshFiles, projectDirectories, sshShell };
};

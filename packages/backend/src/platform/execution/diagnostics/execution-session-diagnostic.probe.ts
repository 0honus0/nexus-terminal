import type {
  DiagnosticContext,
  DiagnosticObservation,
  DiagnosticProbe,
} from '../../diagnostics/diagnostic-probe';
import type { ExecutionSessionManager } from '../execution-session-manager';

export class ExecutionSessionDiagnosticProbe implements DiagnosticProbe {
  readonly id = 'execution.sessions';
  readonly scope = 'execution' as const;

  constructor(private readonly sessions: ExecutionSessionManager) {}

  async collect(context: DiagnosticContext): Promise<DiagnosticObservation> {
    const snapshot = this.sessions.snapshot();
    if (context.subject?.kind === 'execution-session') {
      const session = snapshot.find((item) => item.id === context.subject?.id);
      return session
        ? {
            probeId: this.id,
            scope: this.scope,
            status: session.status === 'ready' ? 'ok' : 'warning',
            summary: `Execution session ${session.status}.`,
            details: {
              sessionId: session.id,
              connectionId: session.connectionId,
              ownerType: session.ownerType,
              ownerId: session.ownerId ?? null,
              status: session.status,
            },
            collectedAt: Date.now(),
          }
        : {
            probeId: this.id,
            scope: this.scope,
            status: 'unavailable',
            summary: 'Execution session not found.',
            collectedAt: Date.now(),
          };
    }

    const workspaceCount = snapshot.filter((item) => item.ownerType === 'workspace').length;
    const agentCount = snapshot.filter((item) => item.ownerType === 'agent').length;
    const systemCount = snapshot.filter((item) => item.ownerType === 'system').length;
    return {
      probeId: this.id,
      scope: this.scope,
      status: 'ok',
      summary: `${snapshot.length} execution session(s) registered.`,
      details: { total: snapshot.length, workspaceCount, agentCount, systemCount },
      collectedAt: Date.now(),
    };
  }
}

import type {
  DiagnosticContext,
  DiagnosticProbe,
  DiagnosticScope,
} from '../../../platform/diagnostics/diagnostic-probe';

export interface DiagnosticAccessPolicy {
  canRun(context: DiagnosticContext, probe: Pick<DiagnosticProbe, 'id' | 'scope'>): boolean;
}

const AGENT_SCOPES = new Set<DiagnosticScope>([
  'foundation',
  'runtime',
  'storage',
  'connection',
  'execution',
  'filesystem',
  'workspace',
  'transfer',
  'notification',
]);

const USER_SUBJECT_SCOPES = new Set<DiagnosticScope>([
  'connection',
  'execution',
  'filesystem',
  'workspace',
  'transfer',
]);

/**
 * Conservative default diagnostics policy.
 *
 * - system callers may inspect every registered read-only probe;
 * - agent callers may use the safe self-diagnostics surface;
 * - user callers must target a concrete product subject and cannot inspect host/storage runtime internals.
 *
 * Interfaces may enforce stricter authorization before calling this service; this policy is the final module-level gate.
 */
export class DefaultDiagnosticAccessPolicy implements DiagnosticAccessPolicy {
  canRun(context: DiagnosticContext, probe: Pick<DiagnosticProbe, 'id' | 'scope'>): boolean {
    if (context.actorType === 'system') return true;
    if (context.actorType === 'agent') return Boolean(context.actorId) && AGENT_SCOPES.has(probe.scope);
    return Boolean(context.actorId && context.subject) && USER_SUBJECT_SCOPES.has(probe.scope);
  }
}

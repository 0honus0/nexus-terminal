export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'unavailable';
export type DiagnosticActorType = 'system' | 'user' | 'agent';

export type DiagnosticScope =
  | 'foundation'
  | 'runtime'
  | 'storage'
  | 'connection'
  | 'execution'
  | 'filesystem'
  | 'workspace'
  | 'transfer'
  | 'notification';

export interface DiagnosticSubject {
  kind: 'connection' | 'execution-session' | 'workspace-session' | 'transfer-task';
  id: string;
}

export interface DiagnosticContext {
  actorType: DiagnosticActorType;
  actorId?: string;
  scopes?: readonly DiagnosticScope[];
  subject?: DiagnosticSubject;
}

export type DiagnosticScalar = string | number | boolean | null;
export type DiagnosticDetails = Readonly<Record<string, DiagnosticScalar | readonly DiagnosticScalar[]>>;

export interface DiagnosticObservation {
  probeId: string;
  scope: DiagnosticScope;
  status: DiagnosticStatus;
  summary: string;
  details?: DiagnosticDetails;
  collectedAt: number;
}

/**
 * Read-only diagnostic extension point. Implementations must never return credentials,
 * raw secrets, private keys, session cookies or arbitrary command output.
 */
export interface DiagnosticProbe {
  readonly id: string;
  readonly scope: DiagnosticScope;
  collect(context: DiagnosticContext): Promise<DiagnosticObservation>;
}

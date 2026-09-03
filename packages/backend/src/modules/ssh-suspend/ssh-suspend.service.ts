export interface SuspendedSession {
  id: string;
  userId: number;
  connectionId: number;
  name: string;
  suspendedAt: number;
}

export interface SshSuspendService {
  list(userId: number): Promise<SuspendedSession[]>;
  resume(userId: number, suspendedSessionId: string): Promise<void>;
  terminate(userId: number, suspendedSessionId: string): Promise<void>;
}

import type { ResolvedSshConnection } from '../../platform/connection/ssh-connection';
import type { ConnectionDetails, ConnectionSummary } from './connection.types';

export interface ConnectionService {
  list(): Promise<ConnectionSummary[]>;
  get(id: number): Promise<ConnectionDetails | null>;
  resolveSsh(id: number): Promise<ResolvedSshConnection>;
}

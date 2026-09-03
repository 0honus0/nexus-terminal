export interface AuditEntry {
  id: number;
  action: string;
  details?: unknown;
  createdAt: number;
}

export interface AuditService {
  record(action: string, details?: unknown): Promise<void>;
  list(limit: number, offset: number): Promise<AuditEntry[]>;
}

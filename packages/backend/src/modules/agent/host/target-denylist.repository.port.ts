export interface TargetDenylistEntry {
  connectionId: number;
  reason: string;
  changedBy: number;
  changedAt: number;
}

export interface TargetDenylistSnapshot {
  revision: number;
  entries: TargetDenylistEntry[];
  eventCursor?: number;
}

export interface TargetDenylistRepositoryPort {
  isDenied(connectionId: number): Promise<boolean>;
  list(): Promise<TargetDenylistEntry[]>;
  snapshot(): Promise<TargetDenylistSnapshot>;
  replace(
    expectedRevision: number,
    connectionIds: readonly number[],
    reason: string,
    changedBy: number,
    changedAt: number,
  ): Promise<TargetDenylistSnapshot>;
}

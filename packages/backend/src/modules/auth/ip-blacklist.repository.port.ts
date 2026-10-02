export interface IpBlacklistEntry {
  ip: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil: number | null;
}
export interface IpBlacklistRepository {
  get(ip: string): Promise<IpBlacklistEntry | null>;
  recordFailure(
    ip: string,
    now: number,
    maxAttempts: number,
    duration: number,
  ): Promise<{ entry: IpBlacklistEntry; newlyBlocked: boolean }>;
  remove(ip: string): Promise<boolean>;
  list(limit: number, offset: number): Promise<{ entries: IpBlacklistEntry[]; total: number }>;
}

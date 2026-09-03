export interface IpBlacklistEntry {
  ip: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil: number | null;
}
export interface IpBlacklistRepository {
  get(ip: string): Promise<IpBlacklistEntry | null>;
  upsert(entry: IpBlacklistEntry): Promise<void>;
  remove(ip: string): Promise<boolean>;
  list(limit: number, offset: number): Promise<{ entries: IpBlacklistEntry[]; total: number }>;
}

export interface CommandHistoryEntry {
  id: number;
  command: string;
  timestamp: number;
}
export interface ExecuteHistoryIntent {
  command: string;
  allSessions?: boolean;
}

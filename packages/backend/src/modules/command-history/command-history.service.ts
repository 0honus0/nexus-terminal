export interface CommandHistoryEntry {
  id: number;
  command: string;
  usedAt: number;
}

export interface CommandHistoryService {
  list(): Promise<CommandHistoryEntry[]>;
}

import type { CommandHistoryEntry, CommandHistoryRepository } from './command-history.repository.port';
export class CommandHistoryService {
  constructor(private readonly repository: CommandHistoryRepository) {}
  add(command: string): Promise<number> {
    return this.repository.upsert(command);
  }
  list(): Promise<CommandHistoryEntry[]> {
    return this.repository.list();
  }
  delete(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }
  clear(): Promise<number> {
    return this.repository.clear();
  }
}

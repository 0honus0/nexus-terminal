export interface QuickCommand {
  id: number;
  name: string;
  command: string;
}

export interface QuickCommandService {
  list(): Promise<QuickCommand[]>;
}

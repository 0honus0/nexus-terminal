export interface QuickCommand {
  id: number;
  name: string | null;
  command: string;
  usage_count: number;
  variables: Record<string, string> | null;
  tagIds: number[];
  created_at: number;
  updated_at: number;
}
export type QuickCommandSort = 'name' | 'usage_count';
export interface QuickCommandRepository {
  create(name: string | null, command: string, variables?: Record<string, string>): Promise<number>;
  update(id: number, name: string | null, command: string, variables?: Record<string, string>): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  list(sortBy?: QuickCommandSort): Promise<QuickCommand[]>;
  incrementUsage(id: number): Promise<boolean>;
  get(id: number): Promise<QuickCommand | null>;
}

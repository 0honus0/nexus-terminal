export interface QuickCommand {
  id: number;
  name: string | null;
  command: string;
  usageCount: number;
  variables: Record<string, string>;
  tagIds: number[];
  createdAt: number;
  updatedAt: number;
}
export type QuickCommandSort = 'name' | 'usageCount';
export interface QuickCommandRepository {
  create(name: string | null, command: string, variables?: Record<string, string>): Promise<number>;
  update(id: number, name: string | null, command: string, variables?: Record<string, string>): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  list(sortBy?: QuickCommandSort): Promise<QuickCommand[]>;
  incrementUsage(id: number): Promise<boolean>;
  get(id: number): Promise<QuickCommand | null>;
}

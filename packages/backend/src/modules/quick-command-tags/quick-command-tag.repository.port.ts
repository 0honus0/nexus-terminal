export interface QuickCommandTag {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}
export interface QuickCommandTagRepository {
  list(): Promise<QuickCommandTag[]>;
  get(id: number): Promise<QuickCommandTag | null>;
  create(name: string): Promise<number>;
  update(id: number, name: string): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  setCommandTags(commandId: number, tagIds: readonly number[]): Promise<void>;
  addTagToCommands(commandIds: readonly number[], tagId: number): Promise<void>;
  listForCommand(commandId: number): Promise<QuickCommandTag[]>;
}

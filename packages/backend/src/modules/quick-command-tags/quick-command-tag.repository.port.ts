export class QuickCommandTagReferenceError extends Error {
  constructor() {
    super('QUICK_COMMAND_TAG_REFERENCE_NOT_FOUND');
  }
}

export interface QuickCommandTag {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}
export interface QuickCommandTagRepository {
  list(): Promise<QuickCommandTag[]>;
  get(id: number): Promise<QuickCommandTag | null>;
  create(name: string): Promise<number>;
  update(id: number, name: string): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  addTagToCommands(commandIds: readonly number[], tagId: number): Promise<void>;
  listForCommand(commandId: number): Promise<QuickCommandTag[]>;
}

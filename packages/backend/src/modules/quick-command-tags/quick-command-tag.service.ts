import type { QuickCommandTag, QuickCommandTagRepository } from './quick-command-tag.repository.port';
export class QuickCommandTagService {
  constructor(private readonly repository: QuickCommandTagRepository) {}
  list(): Promise<QuickCommandTag[]> {
    return this.repository.list();
  }
  get(id: number) {
    return this.repository.get(id);
  }
  create(name: string) {
    return this.repository.create(name.trim());
  }
  update(id: number, name: string) {
    return this.repository.update(id, name.trim());
  }
  delete(id: number) {
    return this.repository.delete(id);
  }
  setCommandTags(commandId: number, tagIds: readonly number[]) {
    return this.repository.setCommandTags(commandId, tagIds);
  }
  addTagToCommands(commandIds: readonly number[], tagId: number) {
    return this.repository.addTagToCommands(commandIds, tagId);
  }
  listForCommand(commandId: number) {
    return this.repository.listForCommand(commandId);
  }
}

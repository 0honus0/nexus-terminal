import type { QuickCommand, QuickCommandRepository, QuickCommandSort } from './quick-command.repository.port';
import type { QuickCommandTagRepository } from '../quick-command-tags/quick-command-tag.repository.port';
export class QuickCommandService {
  constructor(
    private readonly repository: QuickCommandRepository,
    private readonly tags: QuickCommandTagRepository,
  ) {}
  async add(
    name: string | null,
    command: string,
    tagIds: readonly number[] = [],
    variables?: Record<string, string>,
  ): Promise<number> {
    const id = await this.repository.create(name, command, variables);
    await this.tags.setCommandTags(id, tagIds);
    return id;
  }
  async update(
    id: number,
    name: string | null,
    command: string,
    tagIds: readonly number[] = [],
    variables?: Record<string, string>,
  ): Promise<boolean> {
    const updated = await this.repository.update(id, name, command, variables);
    if (updated) await this.tags.setCommandTags(id, tagIds);
    return updated;
  }
  delete(id: number) {
    return this.repository.delete(id);
  }
  list(sortBy: QuickCommandSort = 'name'): Promise<QuickCommand[]> {
    return this.repository.list(sortBy);
  }
  incrementUsage(id: number) {
    return this.repository.incrementUsage(id);
  }
  get(id: number) {
    return this.repository.get(id);
  }
  assignTag(commandIds: readonly number[], tagId: number) {
    return this.tags.addTagToCommands(commandIds, tagId);
  }
}

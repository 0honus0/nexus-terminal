import type { Tag, TagRepository } from './tag.repository.port';
export class TagService {
  constructor(private readonly repository: TagRepository) {}
  list(): Promise<Tag[]> {
    return this.repository.list();
  }
  get(id: number): Promise<Tag | null> {
    return this.repository.get(id);
  }
  async create(name: string): Promise<Tag> {
    const id = await this.repository.create(name.trim());
    const tag = await this.repository.get(id);
    if (!tag) throw new Error('Created tag could not be reloaded.');
    return tag;
  }
  async update(id: number, name: string): Promise<Tag | null> {
    if (!(await this.repository.update(id, name.trim()))) return null;
    return this.repository.get(id);
  }
  delete(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }
  setConnections(tagId: number, connectionIds: readonly number[]): Promise<void> {
    return this.repository.setConnections(tagId, connectionIds);
  }
}

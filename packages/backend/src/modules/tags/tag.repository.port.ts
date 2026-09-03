export interface Tag {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}
export interface TagRepository {
  list(): Promise<Tag[]>;
  get(id: number): Promise<Tag | null>;
  create(name: string): Promise<number>;
  update(id: number, name: string): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  setConnections(tagId: number, connectionIds: readonly number[]): Promise<void>;
}

import { httpClient } from '@/client/http';
import type { ConnectionTag } from '../model/tag';
export const tagsApi = {
  async list(): Promise<ConnectionTag[]> {
    return (await httpClient.get<ConnectionTag[]>('/tags')).data;
  },
  async create(name: string): Promise<ConnectionTag> {
    return (await httpClient.post<{ tag: ConnectionTag }>('/tags', { name })).data.tag;
  },
  async update(id: number, name: string): Promise<ConnectionTag> {
    return (await httpClient.put<{ tag: ConnectionTag }>(`/tags/${id}`, { name })).data.tag;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete(`/tags/${id}`);
  },
  async setConnections(id: number, connectionIds: number[]): Promise<void> {
    await httpClient.put(`/tags/${id}/connections`, { connectionIds });
  },
  async ensure(names: string[]): Promise<ConnectionTag[]> {
    const existing = await this.list();
    const byName = new Map(existing.map((t) => [t.name, t]));
    for (const raw of names) {
      const name = raw.trim();
      if (!name || byName.has(name)) continue;
      const tag = await this.create(name);
      byName.set(name, tag);
    }
    return names.map((n) => byName.get(n.trim())).filter((v): v is ConnectionTag => Boolean(v));
  },
};

import type {
  ConnectionTagDto,
  TagConnectionsRequestDto,
  TagMutationResponseDto,
  TagNameRequestDto,
} from '@nexus-terminal/protocol/connections';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';

export const tagsApi = {
  async list(): Promise<ConnectionTagDto[]> {
    return (await httpClient.get<ConnectionTagDto[]>('/tags')).data;
  },
  async create(name: string): Promise<ConnectionTagDto> {
    const request: TagNameRequestDto = { name };
    return (await httpClient.post<TagMutationResponseDto>('/tags', request)).data.tag;
  },
  async update(id: number, name: string): Promise<ConnectionTagDto> {
    const request: TagNameRequestDto = { name };
    return (await httpClient.put<TagMutationResponseDto>(`/tags/${id}`, request)).data.tag;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/tags/${id}`);
  },
  async setConnections(id: number, connectionIds: number[]): Promise<void> {
    const request: TagConnectionsRequestDto = { connectionIds };
    await httpClient.put<MessageResponseDto>(`/tags/${id}/connections`, request);
  },
  async ensure(names: string[]): Promise<ConnectionTagDto[]> {
    const existing = await this.list();
    const byName = new Map(existing.map((t) => [t.name, t]));
    for (const raw of names) {
      const name = raw.trim();
      if (!name || byName.has(name)) continue;
      const tag = await this.create(name);
      byName.set(name, tag);
    }
    return names.map((n) => byName.get(n.trim())).filter((v): v is ConnectionTagDto => Boolean(v));
  },
};

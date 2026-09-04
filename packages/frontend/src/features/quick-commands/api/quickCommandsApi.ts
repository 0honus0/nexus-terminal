import { httpClient } from '@/client/http';
import type { QuickCommand, QuickCommandInput, QuickCommandTag } from '../model/quickCommand';

export const quickCommandsApi = {
  async list(): Promise<QuickCommand[]> {
    return (await httpClient.get<QuickCommand[]>('/quick-commands')).data;
  },
  async create(input: QuickCommandInput): Promise<QuickCommand> {
    return (await httpClient.post<{ command: QuickCommand }>('/quick-commands', input)).data.command;
  },
  async update(id: number, input: QuickCommandInput): Promise<QuickCommand> {
    return (await httpClient.put<{ command: QuickCommand }>(`/quick-commands/${id}`, input)).data.command;
  },
  async remove(id: number) {
    await httpClient.delete(`/quick-commands/${id}`);
  },
  async incrementUsage(id: number): Promise<QuickCommand | null> {
    return (await httpClient.post<{ command: QuickCommand | null }>(`/quick-commands/${id}/increment-usage`)).data
      .command;
  },
  async listTags(): Promise<QuickCommandTag[]> {
    return (await httpClient.get<QuickCommandTag[]>('/quick-command-tags')).data;
  },
  async createTag(name: string): Promise<QuickCommandTag> {
    return (await httpClient.post<{ tag: QuickCommandTag }>('/quick-command-tags', { name })).data.tag;
  },
  async renameTag(id: number, name: string): Promise<QuickCommandTag> {
    return (await httpClient.put<{ tag: QuickCommandTag }>(`/quick-command-tags/${id}`, { name })).data.tag;
  },
  async removeTag(id: number) {
    await httpClient.delete(`/quick-command-tags/${id}`);
  },
  async assignTag(commandIds: number[], tagId: number) {
    await httpClient.post('/quick-commands/bulk-assign-tag', { commandIds, tagId });
  },
};

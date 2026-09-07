import { httpClient } from '@/client/http';
import type { CommandHistoryEntry } from '../model/commandHistory';
export const commandHistoryApi = {
  async list() {
    return (await httpClient.get<CommandHistoryEntry[]>('/command-history')).data;
  },
  async add(command: string) {
    return (await httpClient.post<{ id: number }>('/command-history', { command })).data.id;
  },
  async remove(id: number) {
    await httpClient.delete(`/command-history/${id}`);
  },
  async clear() {
    return (await httpClient.delete<{ count: number }>('/command-history')).data.count;
  },
};

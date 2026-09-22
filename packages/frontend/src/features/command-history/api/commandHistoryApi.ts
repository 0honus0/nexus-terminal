import type {
  CommandHistoryAddRequestDto,
  CommandHistoryAddResponseDto,
  CommandHistoryClearResponseDto,
  CommandHistoryEntryDto,
} from '@nexus-terminal/protocol/command-history';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { CommandHistoryEntry } from '../model/commandHistory';

export const commandHistoryApi = {
  async list(): Promise<CommandHistoryEntry[]> {
    return (await httpClient.get<CommandHistoryEntryDto[]>('/command-history')).data;
  },
  async add(command: string): Promise<number> {
    const request: CommandHistoryAddRequestDto = { command };
    return (await httpClient.post<CommandHistoryAddResponseDto>('/command-history', request)).data.id;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/command-history/${id}`);
  },
  async clear(): Promise<number> {
    return (await httpClient.delete<CommandHistoryClearResponseDto>('/command-history')).data.count;
  },
};

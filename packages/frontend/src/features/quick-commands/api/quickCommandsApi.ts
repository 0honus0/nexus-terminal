import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type {
  QuickCommandBulkAssignTagRequestDto,
  QuickCommandBulkAssignTagResponseDto,
  QuickCommandDto,
  QuickCommandIncrementResponseDto,
  QuickCommandListQueryDto,
  QuickCommandMutationRequestDto,
  QuickCommandMutationResponseDto,
  QuickCommandTagDto,
  QuickCommandTagMutationResponseDto,
  QuickCommandTagNameRequestDto,
} from '@nexus-terminal/protocol/quick-commands';
import { httpClient } from '@/client/http';
import type { QuickCommandFormInput } from '../model/quickCommand';

const requireCommand = (command: QuickCommandDto | null | undefined): QuickCommandDto => {
  if (!command) throw new Error('Quick command response did not include a command.');
  return command;
};

const requireTag = (tag: QuickCommandTagDto | null | undefined): QuickCommandTagDto => {
  if (!tag) throw new Error('Quick command tag response did not include a tag.');
  return tag;
};

export const quickCommandsApi = {
  async list(sortBy: QuickCommandListQueryDto['sortBy'] = 'name'): Promise<QuickCommandDto[]> {
    const params: QuickCommandListQueryDto = { sortBy };
    return (await httpClient.get<QuickCommandDto[]>('/quick-commands', { params })).data;
  },
  async create(input: QuickCommandFormInput): Promise<QuickCommandDto> {
    const request: QuickCommandMutationRequestDto = input;
    const response = await httpClient.post<QuickCommandMutationResponseDto>('/quick-commands', request);
    return requireCommand(response.data.command);
  },
  async update(id: number, input: QuickCommandFormInput): Promise<QuickCommandDto> {
    const request: QuickCommandMutationRequestDto = input;
    const response = await httpClient.put<QuickCommandMutationResponseDto>(`/quick-commands/${id}`, request);
    return requireCommand(response.data.command);
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/quick-commands/${id}`);
  },
  async incrementUsage(id: number): Promise<QuickCommandDto | null> {
    return (await httpClient.post<QuickCommandIncrementResponseDto>(`/quick-commands/${id}/increment-usage`)).data
      .command;
  },
  async listTags(): Promise<QuickCommandTagDto[]> {
    return (await httpClient.get<QuickCommandTagDto[]>('/quick-command-tags')).data;
  },
  async createTag(name: string): Promise<QuickCommandTagDto> {
    const request: QuickCommandTagNameRequestDto = { name };
    const response = await httpClient.post<QuickCommandTagMutationResponseDto>('/quick-command-tags', request);
    return requireTag(response.data.tag);
  },
  async renameTag(id: number, name: string): Promise<QuickCommandTagDto> {
    const request: QuickCommandTagNameRequestDto = { name };
    const response = await httpClient.put<QuickCommandTagMutationResponseDto>(`/quick-command-tags/${id}`, request);
    return requireTag(response.data.tag);
  },
  async removeTag(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/quick-command-tags/${id}`);
  },
  async assignTag(commandIds: number[], tagId: number): Promise<void> {
    const request: QuickCommandBulkAssignTagRequestDto = { commandIds, tagId };
    await httpClient.post<QuickCommandBulkAssignTagResponseDto>('/quick-commands/bulk-assign-tag', request);
  },
};

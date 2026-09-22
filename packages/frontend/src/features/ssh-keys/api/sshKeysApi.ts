import type {
  SshKeyCreateRequestDto,
  SshKeyMutationResponseDto,
  SshKeySummaryDto,
  SshKeyUpdateRequestDto,
} from '@nexus-terminal/protocol/connections';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { SshKeyFormInput } from '../model/sshKey';

export const sshKeysApi = {
  async list(): Promise<SshKeySummaryDto[]> {
    return (await httpClient.get<SshKeySummaryDto[]>('/ssh-keys')).data;
  },
  async create(input: SshKeyFormInput): Promise<SshKeySummaryDto> {
    if (typeof input.privateKey !== 'string') throw new Error('privateKey is required to create an SSH key.');
    const request: SshKeyCreateRequestDto = { ...input, privateKey: input.privateKey };
    const response = await httpClient.post<SshKeyMutationResponseDto>('/ssh-keys', request);
    return response.data.key;
  },
  async update(id: number, input: SshKeyFormInput): Promise<SshKeySummaryDto> {
    const request: SshKeyUpdateRequestDto = input;
    const response = await httpClient.put<SshKeyMutationResponseDto>(`/ssh-keys/${id}`, request);
    return response.data.key;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/ssh-keys/${id}`);
  },
};

import type { ResourceStatusDto, SshResourceStatusDto } from '@nexus-terminal/protocol/system';
import { httpClient } from '@/client/http';

export const systemOverviewApi = {
  async local(): Promise<ResourceStatusDto> {
    return (await httpClient.get<ResourceStatusDto>('/system/status')).data;
  },
  async ssh(connectionId: number): Promise<SshResourceStatusDto> {
    return (await httpClient.get<SshResourceStatusDto>(`/system/ssh-resources/${connectionId}`)).data;
  },
};

import type { ResourceStatusDto, SshResourceStatusDto } from '@nexus-terminal/protocol/system';
import { httpClient } from '@/client/http';
import type { ResourceStatus, SshResourceStatus } from '../model/systemOverview';

export const systemOverviewApi = {
  async local(): Promise<ResourceStatus> {
    return (await httpClient.get<ResourceStatusDto>('/system/status')).data;
  },
  async ssh(): Promise<SshResourceStatus[]> {
    return (await httpClient.get<SshResourceStatusDto[]>('/system/ssh-resources')).data;
  },
};

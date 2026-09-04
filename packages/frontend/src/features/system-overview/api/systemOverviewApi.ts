import { httpClient } from '@/client/http';
import type { ResourceStatus, SshResourceStatus } from '../model/systemOverview';
export const systemOverviewApi = {
  async local(): Promise<ResourceStatus> {
    return (await httpClient.get<ResourceStatus>('/system/status')).data;
  },
  async ssh(): Promise<SshResourceStatus[]> {
    return (await httpClient.get<SshResourceStatus[]>('/system/ssh-resources')).data;
  },
};

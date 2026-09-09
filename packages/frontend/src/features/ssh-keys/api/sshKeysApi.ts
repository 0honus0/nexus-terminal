import { httpClient } from '@/client/http';
import type { SshKeyInput, SshKeySummary } from '../model/sshKey';
export const sshKeysApi = {
  async list(): Promise<SshKeySummary[]> {
    return (await httpClient.get<SshKeySummary[]>('/ssh-keys')).data;
  },
  async create(input: SshKeyInput): Promise<SshKeySummary> {
    const r = await httpClient.post<{ key: SshKeySummary }>('/ssh-keys', input);
    return r.data.key;
  },
  async update(id: number, input: SshKeyInput): Promise<SshKeySummary> {
    const r = await httpClient.put<{ key: SshKeySummary }>(`/ssh-keys/${id}`, input);
    return r.data.key;
  },
  async remove(id: number): Promise<void> {
    await httpClient.delete(`/ssh-keys/${id}`);
  },
};

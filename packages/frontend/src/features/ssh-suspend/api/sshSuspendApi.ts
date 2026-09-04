import { httpClient } from '@/client/http';
import type { SuspendedSession } from '../model/sshSuspend';

export const sshSuspendApi = {
  async list(): Promise<SuspendedSession[]> {
    return (await httpClient.get<SuspendedSession[]>('/ssh-suspend/suspended-sessions')).data;
  },

  async terminate(id: string): Promise<void> {
    await httpClient.delete(`/ssh-suspend/terminate/${encodeURIComponent(id)}`);
  },

  async removeDisconnected(id: string): Promise<void> {
    await httpClient.delete(`/ssh-suspend/entry/${encodeURIComponent(id)}`);
  },

  async rename(id: string, customName: string): Promise<string> {
    const { data } = await httpClient.put<{ customName: string }>(`/ssh-suspend/name/${encodeURIComponent(id)}`, {
      customName,
    });
    return data.customName;
  },

  async exportLog(id: string): Promise<string> {
    const response = await httpClient.get<Blob>(`/ssh-suspend/log/${encodeURIComponent(id)}`, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] ?? `ssh-session-${id.slice(0, 8)}.log`;
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
};
